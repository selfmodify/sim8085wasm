/*
 * sim8085_core.c
 * -----------------------------------------------------------------------
 * Portable C implementation of the 8085 simulator core.
 * Compiled from the original DOS source by V. Kumar (1995).
 *
 * This file contains:
 *   1. Global state
 *   2. Memory access (safe, bounds-checked)
 *   3. Flag manipulation
 *   4. CPU instruction implementations (all 8085 opcodes)
 *   5. Two-pass assembler (lexer + parser + symbol table)
 *   6. System calls (Intel SDK CALL 5 interface)
 *   7. Machine init / step / run
 *
 * No DOS, conio.h, dos.h, BIOS, or video RAM dependencies.
 * Compiles cleanly with: gcc, clang, emcc (Emscripten).
 * -----------------------------------------------------------------------
 */

#include "sim8085_core.h"
#include <stdarg.h>

/* -----------------------------------------------------------------------
 * Global state
 * --------------------------------------------------------------------- */
machine_ptr  _8085  = NULL;
machine_ptr   m     = NULL;
unsigned long data  = 0;
int           g_memory_size = 65536;
long          X     = 0;
uchar         code  = 0;
unsigned      r1    = 0;
unsigned      r2    = 0;
lex_struct    state;
symbol_table  table;

/* Last assembler error message (for the web API) */
static char   g_last_error[512] = "";

/* Cumulative T-state cycle counter */
static uint64_t g_cycles = 0;

/* Per-address execution hit counters (profiler) */
static uint32_t g_hitcnt[65536];

/* SID/SOD serial pins */
static uint8_t g_sid = 0;   /* Serial Input Data (set externally, read by RIM bit 7) */
static uint8_t g_sod = 0;   /* Serial Output Data (written by SIM bits 6-7) */

/* T-states per opcode (8085, typical/taken path) */
static const uint8_t g_tstates[256] = {
 /* 00-07 */ 4,10, 7, 6, 4, 4, 7, 4,
 /* 08-0F */ 4,10, 7, 6, 4, 4, 7, 4,
 /* 10-17 */ 4,10, 7, 6, 4, 4, 7, 4,
 /* 18-1F */ 4,10, 7, 6, 4, 4, 7, 4,
 /* 20-27 */ 4,10,16, 6, 4, 4, 7, 4,
 /* 28-2F */ 4,10,16, 6, 4, 4, 7, 4,
 /* 30-37 */ 4,10,13, 6,10,10,10, 4,
 /* 38-3F */ 4,10,13, 6, 4, 4, 7, 4,
 /* 40-7F (MOV; 0x76=HLT) */
    5, 5, 5, 5, 5, 5, 7, 5,
    5, 5, 5, 5, 5, 5, 7, 5,
    5, 5, 5, 5, 5, 5, 7, 5,
    5, 5, 5, 5, 5, 5, 7, 5,
    5, 5, 5, 5, 5, 5, 7, 5,
    5, 5, 5, 5, 5, 5, 7, 5,
    7, 7, 7, 7, 7, 7, 5, 7,
    5, 5, 5, 5, 5, 5, 7, 5,
 /* 80-BF (ALU reg/mem) */
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
    4, 4, 4, 4, 4, 4, 7, 4,
 /* C0-C7 */ 12,10,10,10,18,12,7,12,
 /* C8-CF */ 12,10,10,10,18,18,7,12,
 /* D0-D7 */ 12,10,10,10,18,12,7,12,
 /* D8-DF */ 12,10,10,10,18,18,7,12,
 /* E0-E7 */ 12,10,10,16,18,12,7,12,
 /* E8-EF */ 12, 6,10, 4,18,18,7,12,
 /* F0-F7 */ 12,10,10, 4,18,12,7,12,
 /* F8-FF */ 12, 6,10, 4,18,18,7,12,
};

/* LED callback - set by the web layer */
static void (*g_led_callback)(int field_type, int index, int value) = NULL;

void sim_set_led_callback(void (*cb)(int, int, int)) {
    g_led_callback = cb;
}

/* OUT callback - called whenever an OUT instruction executes */
static void (*g_out_callback)(uint8_t port, uint8_t val) = NULL;

void sim_set_out_callback(void (*cb)(uint8_t port, uint8_t val)) {
    g_out_callback = cb;
}

/* -----------------------------------------------------------------------
 * Error message strings (from original MYERROR.H)
 * --------------------------------------------------------------------- */
static const char *error_msg[] = {
    "Unknown error",                         /* 0: placeholder */
    "File not found",                        /* 1 */
    "Register expected",                     /* 2 */
    "Register or memory expected",           /* 3 */
    "Comma expected",                        /* 4 */
    "Number expected",                       /* 5 */
    "Bad number format",                     /* 6 */
    "Number too large",                      /* 7 */
    "Illegal memory-to-memory transfer",     /* 8 */
    "Wrong register",                        /* 9 */
    "Address too large",                     /* 10 */
    "Extra input after instruction",         /* 11 */
    "Symbol table full",                     /* 12 */
    "Symbol not found",                      /* 13 */
    "Execution error",                       /* 14 */
    "Invalid opcode",                        /* 15 */
    "Read segment fault",                    /* 16 */
    "Write segment fault",                   /* 17 */
    "Stack overflow",                        /* 18 */
    "Stack underflow",                       /* 19 */
    "Bad system call",                       /* 20 */
    "Illegal directive",                     /* 21 */
    "Directive value too large",             /* 22 */
    "Syntax error",                          /* 23 */
    "Duplicate label",                       /* 24 */
    "Label not found",                       /* 25 */
    "Undefined label",                       /* 26 */
    "Memory-to-memory transfer",             /* 27 */
    "Too many errors - assembly stopped",    /* 28 */
    "Colon expected after label",            /* 29 */
    "Insufficient memory",                   /* 30 */
};
#define NUM_ERROR_MSGS (sizeof(error_msg)/sizeof(error_msg[0]))

int SetAndPrintError(int num) {
    int idx = -num;
    if (idx >= 0 && idx < (int)NUM_ERROR_MSGS)
        snprintf(g_last_error, sizeof(g_last_error),
                 "Line %d: %s", LINE_NUMBER(), error_msg[idx]);
    else
        snprintf(g_last_error, sizeof(g_last_error),
                 "Line %d: error %d", LINE_NUMBER(), num);
    SET_STATUS(SEVERE_ERROR);
    return 0;
}

int BadSystemCall(void) {
    SET_STATUS(BADSYSTEMCALL | SEVERE_ERROR);
    snprintf(g_last_error, sizeof(g_last_error), "Bad system call at 0x%04X", GetIP());
    return 0;
}

const char *sim_get_last_error(void) { return g_last_error; }
uint64_t sim_get_cycles(void)        { return g_cycles; }
void     sim_set_cycles(uint64_t n)  { g_cycles = n; }
uint32_t sim_get_hitcnt(uint16_t a)  { return g_hitcnt[a]; }
void     sim_reset_profile(void)     { memset(g_hitcnt, 0, sizeof(g_hitcnt)); }
uint8_t  sim_get_sid(void)           { return g_sid; }
void     sim_set_sid(uint8_t v)      { g_sid = v & 1; }
uint8_t  sim_get_sod(void)           { return g_sod; }

/* -----------------------------------------------------------------------
 * Machine init
 * --------------------------------------------------------------------- */
int InitMachine(machine_ptr mp) {
    memset(mp, 0, sizeof(machine));
    mp->cpu.r.ip  = DEFAULT_IP;
    mp->cpu.r.sp  = 0;
    mp->cpu.ptr   = DEFAULT_KICKOFF;
    mp->status    = 0;
    mp->i.bk_ctr  = 0;
    mp->intr_info.ei = 1;
    g_last_error[0] = '\0';
    g_cycles = 0;
    g_sid = 0; g_sod = 0;
    memset(g_hitcnt, 0, sizeof(g_hitcnt));
    return 1;
}

/* -----------------------------------------------------------------------
 * Memory access (safe, bounds-checked)
 * --------------------------------------------------------------------- */
word SetIP(unsigned i) {
    if (i >= (unsigned)g_memory_size) {
        SET_STATUS(IP_BEYOND_MEMORY);
        return KIT->cpu.r.ip;
    }
    return (KIT->cpu.r.ip = i);
}

uchar GetMemByte(unsigned a) {
    a &= 0xFFFF;
    if (a >= (unsigned)g_memory_size) {
        SET_STATUS(READ_FAULT | SEVERE_ERROR);
        return 0;
    }
    return KIT->cpu.ram[a];
}

word GetMemWord(unsigned a) {
    a &= 0xFFFF;
    uchar lo = GetMemByte(a);
    uchar hi = GetMemByte((a + 1) & 0xFFFF);
    return lo | ((word)hi << 8);
}

uchar SetMemByte(unsigned a, uchar val) {
    a &= 0xFFFF;
    if (a >= (unsigned)g_memory_size) {
        SET_STATUS(WRITE_FAULT | SEVERE_ERROR);
        return 0;
    }
    return (KIT->cpu.ram[a] = val);
}

word SetMemWord(unsigned a, word val) {
    a &= 0xFFFF;
    SetMemByte(a, (uchar)(val & 0xFF));
    SetMemByte((a + 1) & 0xFFFF, (uchar)(val >> 8));
    return val;
}

/* -----------------------------------------------------------------------
 * Flag manipulation (from original FLAGS.H)
 * --------------------------------------------------------------------- */
#define SIGN        0x80
#define ZERO        0x40
#define AUX_CARRY   0x10
#define PARITY      0x04
#define CARRY       0x01

int GetCarry(void)    { return (GetFlag() & CARRY)    ? 1 : 0; }
int GetAuxCarry(void) { return (GetFlag() & AUX_CARRY)? 1 : 0; }
int GetZero(void)     { return (GetFlag() & ZERO)     ? 1 : 0; }
int GetSign(void)     { return (GetFlag() & SIGN)     ? 1 : 0; }
int GetParity(void)   { return (GetFlag() & PARITY)   ? 1 : 0; }

int SetCarry(int x)    { return x ? SetFlag(GetFlag()|CARRY)    :SetFlag(GetFlag()&~CARRY);    }
int SetAuxCarry(int x) { return x ? SetFlag(GetFlag()|AUX_CARRY):SetFlag(GetFlag()&~AUX_CARRY);}
int SetZero(int x)     { return x ? SetFlag(GetFlag()|ZERO)     :SetFlag(GetFlag()&~ZERO);     }
int SetSign(int x)     { return x ? SetFlag(GetFlag()|SIGN)     :SetFlag(GetFlag()&~SIGN);     }
int SetParity(int x)   { return x ? SetFlag(GetFlag()|PARITY)   :SetFlag(GetFlag()&~PARITY);   }

static int ComputeParity(int val) {
    int bits = 0;
    val &= 0xFF;
    while (val) { bits += (val & 1); val >>= 1; }
    return (bits % 2 == 0) ? 1 : 0;
}

void Set8085Flag(void) {
    int tmp = (int)GetTemp();
    int result8 = tmp & 0xFF;
    SetSign (result8 & 0x80 ? 1 : 0);
    SetZero (result8 == 0   ? 1 : 0);
    SetParity(ComputeParity(result8));
    SetCarry (tmp > 255 || tmp < 0 ? 1 : 0);
}

int ShouldSetAuxillaryFlag(int a, int b, int sign) {
    if (sign == PLUS)
        return ((a & 0xF) + (b & 0xF)) > 0xF ? 1 : 0;
    else
        return ((a & 0xF) - (b & 0xF)) < 0 ? 1 : 0;
}

/* -----------------------------------------------------------------------
 * Helper: stack push / pop
 * --------------------------------------------------------------------- */
static void StackPush(word val) {
    SetSP((GetSP() - 1) & 0xFFFF); SetMemByte(GetSP(), (uchar)(val >> 8));
    SetSP((GetSP() - 1) & 0xFFFF); SetMemByte(GetSP(), (uchar)(val & 0xFF));
}

static word StackPop(void) {
    word lo, hi;
    lo = GetMemByte(GetSP()); SetSP((GetSP() + 1) & 0xFFFF);
    hi = GetMemByte(GetSP()); SetSP((GetSP() + 1) & 0xFFFF);
    return (word)((hi << 8) | lo);
}

/* -----------------------------------------------------------------------
 * CPU instruction implementations
 * All return the byte-length of the instruction (used to advance IP).
 * --------------------------------------------------------------------- */

/* NOP / HLT / EI / DI */
static int _Nop(void) { return NOP_LEN; }
static int _Hlt(void) {
    /* Advance PC past HLT, then halt-wait for interrupt (matches real 8085) */
    KIT->cpu.r.ip = (KIT->cpu.r.ip + 1) & 0xFFFF;
    SET_STATUS(HALTED);   /* NOT QUIT — interrupt resumes execution */
    return 0;             /* IP already advanced */
}
static int _Di(void)  { INTR().ei = 0; INTR().iff_next = 0; return DI_LEN; }
static int _Ei(void)  { INTR().iff_next = 1; return EI_LEN; }

/* --- Data movement: MOV --- */
#define DEF_MOV(dst,src,get_src) \
static int _Mov##dst##src(void) { Set##dst(get_src()); return MOV_LEN; }

DEF_MOV(A,A,GetA) DEF_MOV(A,B,GetB) DEF_MOV(A,C,GetC) DEF_MOV(A,D,GetD)
DEF_MOV(A,E,GetE) DEF_MOV(A,H,GetH) DEF_MOV(A,L,GetL)
DEF_MOV(B,A,GetA) DEF_MOV(B,B,GetB) DEF_MOV(B,C,GetC) DEF_MOV(B,D,GetD)
DEF_MOV(B,E,GetE) DEF_MOV(B,H,GetH) DEF_MOV(B,L,GetL)
DEF_MOV(C,A,GetA) DEF_MOV(C,B,GetB) DEF_MOV(C,C,GetC) DEF_MOV(C,D,GetD)
DEF_MOV(C,E,GetE) DEF_MOV(C,H,GetH) DEF_MOV(C,L,GetL)
DEF_MOV(D,A,GetA) DEF_MOV(D,B,GetB) DEF_MOV(D,C,GetC) DEF_MOV(D,D,GetD)
DEF_MOV(D,E,GetE) DEF_MOV(D,H,GetH) DEF_MOV(D,L,GetL)
DEF_MOV(E,A,GetA) DEF_MOV(E,B,GetB) DEF_MOV(E,C,GetC) DEF_MOV(E,D,GetD)
DEF_MOV(E,E,GetE) DEF_MOV(E,H,GetH) DEF_MOV(E,L,GetL)
DEF_MOV(H,A,GetA) DEF_MOV(H,B,GetB) DEF_MOV(H,C,GetC) DEF_MOV(H,D,GetD)
DEF_MOV(H,E,GetE) DEF_MOV(H,H,GetH) DEF_MOV(H,L,GetL)
DEF_MOV(L,A,GetA) DEF_MOV(L,B,GetB) DEF_MOV(L,C,GetC) DEF_MOV(L,D,GetD)
DEF_MOV(L,E,GetE) DEF_MOV(L,H,GetH) DEF_MOV(L,L,GetL)

/* MOV r,M and MOV M,r */
#define DEF_MOV_FM(reg) \
static int _Mov##reg##M(void) { Set##reg(GetMemByte(GetHL())); return MOV_LEN; }
DEF_MOV_FM(A) DEF_MOV_FM(B) DEF_MOV_FM(C) DEF_MOV_FM(D)
DEF_MOV_FM(E) DEF_MOV_FM(H) DEF_MOV_FM(L)

#define DEF_MOV_TM(reg,get) \
static int _MovM##reg(void) { SetMemByte(GetHL(), get()); return MOV_LEN; }
DEF_MOV_TM(A,GetA) DEF_MOV_TM(B,GetB) DEF_MOV_TM(C,GetC) DEF_MOV_TM(D,GetD)
DEF_MOV_TM(E,GetE) DEF_MOV_TM(H,GetH) DEF_MOV_TM(L,GetL)

/* MVI r, imm8 */
#define DEF_MVI(reg) \
static int _Mvi##reg(void) { Set##reg(GetMemByte(GetIP()+1)); return MVI_LEN; }
DEF_MVI(A) DEF_MVI(B) DEF_MVI(C) DEF_MVI(D) DEF_MVI(E) DEF_MVI(H) DEF_MVI(L)
static int _MviM(void) { SetMemByte(GetHL(), GetMemByte(GetIP()+1)); return MVI_LEN; }

/* LXI rp, imm16 */
#define DEF_LXI(hi,lo,set_hi,set_lo) \
static int _Lxi##hi(void) { \
    set_lo(GetMemByte(GetIP()+1)); set_hi(GetMemByte(GetIP()+2)); return LXI_LEN; }
DEF_LXI(B,C,SetB,SetC) DEF_LXI(D,E,SetD,SetE) DEF_LXI(H,L,SetH,SetL)
static int _LxiSP(void) {
    SetSP(GetMemWord(GetIP()+1)); return LXI_LEN; }

/* LDAX/STAX */
static int _LdaxB(void) { SetA(GetMemByte(GetBC())); return LDAX_LEN; }
static int _LdaxD(void) { SetA(GetMemByte(GetDE())); return LDAX_LEN; }
static int _StaxB(void) { SetMemByte(GetBC(), GetA()); return STAX_LEN; }
static int _StaxD(void) { SetMemByte(GetDE(), GetA()); return STAX_LEN; }

/* LDA/STA */
static int _LdA(void)  { SetA(GetMemByte(GetMemWord(GetIP()+1))); return LDA_LEN; }
static int _StA(void)  { SetMemByte(GetMemWord(GetIP()+1), GetA()); return STA_LEN; }

/* LHLD/SHLD */
static int _LHLd(void) {
    word a = GetMemWord(GetIP()+1);
    SetL(GetMemByte(a)); SetH(GetMemByte(a+1)); return LHLD_LEN; }
static int _SHLd(void) {
    word a = GetMemWord(GetIP()+1);
    SetMemByte(a, GetL()); SetMemByte(a+1, GetH()); return SHLD_LEN; }

/* XCHG, XTHL, SPHL */
static int _Xchg(void) {
    uchar t;
    t=GetD(); SetD(GetH()); SetH(t);
    t=GetE(); SetE(GetL()); SetL(t);
    return XCHG_LEN; }
static int _Xthl(void) {
    uchar tl=GetL(), th=GetH();
    SetL(GetMemByte(GetSP())); SetMemByte(GetSP(), tl);
    SetH(GetMemByte(GetSP()+1)); SetMemByte(GetSP()+1, th);
    return XTHL_LEN; }
static int _Sphl(void) { SetSP(GetHL()); return SPHL_LEN; }

/* PUSH/POP */
#define DEF_PUSH(name,hi,lo) \
static int _Push##name(void) { StackPush((word)((hi()<<8)|lo())); return PUSH_LEN; }
DEF_PUSH(B,GetB,GetC) DEF_PUSH(D,GetD,GetE) DEF_PUSH(H,GetH,GetL)
static int _PushPsw(void) { StackPush(GetPsw()); return PUSH_LEN; }

#define DEF_POP(name,set_hi,set_lo) \
static int _Pop##name(void) { word v=StackPop(); set_lo(v&0xFF); set_hi(v>>8); return POP_LEN; }
DEF_POP(B,SetB,SetC) DEF_POP(D,SetD,SetE) DEF_POP(H,SetH,SetL)
static int _PopPsw(void) { word v=StackPop(); SetFlag(v&0xFF); SetA(v>>8); return POP_LEN; }

/* --- Arithmetic: ADD/ADC/SUB/SBB --- */
#define DEF_ADD(reg,get) \
static int _Add##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),get(),PLUS)); \
    SetA(SetTemp(GetA()+get()) & LARGEST_INT); \
    Set8085Flag(); return ADD_LEN; }
DEF_ADD(A,GetA) DEF_ADD(B,GetB) DEF_ADD(C,GetC) DEF_ADD(D,GetD)
DEF_ADD(E,GetE) DEF_ADD(H,GetH) DEF_ADD(L,GetL)
static int _AddM(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetHL()),PLUS));
    SetA(SetTemp(GetA()+GetMemByte(GetHL())) & LARGEST_INT);
    Set8085Flag(); return ADD_LEN; }

static int _Adi(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetIP()+1),PLUS));
    SetTemp(GetA()+GetMemByte(GetIP()+1));
    SetA(GetTemp() & LARGEST_INT); Set8085Flag(); return ADI_LEN; }

#define DEF_ADC(reg,get) \
static int _Adc##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),get()+GetCarry(),PLUS)); \
    SetA(SetTemp(GetA()+get()+GetCarry()) & LARGEST_INT); \
    Set8085Flag(); return ADC_LEN; }
DEF_ADC(A,GetA) DEF_ADC(B,GetB) DEF_ADC(C,GetC) DEF_ADC(D,GetD)
DEF_ADC(E,GetE) DEF_ADC(H,GetH) DEF_ADC(L,GetL)
static int _AdcM(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetHL())+GetCarry(),PLUS));
    SetA(SetTemp(GetA()+GetMemByte(GetHL())+GetCarry()) & LARGEST_INT);
    Set8085Flag(); return ADC_LEN; }
static int _Aci(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetIP()+1)+GetCarry(),PLUS));
    SetTemp(GetA()+GetMemByte(GetIP()+1)+GetCarry());
    SetA(GetTemp() & LARGEST_INT); Set8085Flag(); return ACI_LEN; }

#define DEF_SUB(reg,get) \
static int _Sub##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),get(),MINUS)); \
    SetA(SetTemp(GetA()-get()) & LARGEST_INT); \
    Set8085Flag(); return SUB_LEN; }
DEF_SUB(A,GetA) DEF_SUB(B,GetB) DEF_SUB(C,GetC) DEF_SUB(D,GetD)
DEF_SUB(E,GetE) DEF_SUB(H,GetH) DEF_SUB(L,GetL)
static int _SubM(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetHL()),MINUS));
    SetA(SetTemp(GetA()-GetMemByte(GetHL())) & LARGEST_INT);
    Set8085Flag(); return SUB_LEN; }
static int _Sui(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetIP()+1),MINUS));
    SetTemp(GetA()-GetMemByte(GetIP()+1));
    SetA(GetTemp() & LARGEST_INT); Set8085Flag(); return SUI_LEN; }

#define DEF_SBB(reg,get) \
static int _Sbb##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),get()+GetCarry(),MINUS)); \
    SetA(SetTemp(GetA()-get()-GetCarry()) & LARGEST_INT); \
    Set8085Flag(); return SBB_LEN; }
DEF_SBB(A,GetA) DEF_SBB(B,GetB) DEF_SBB(C,GetC) DEF_SBB(D,GetD)
DEF_SBB(E,GetE) DEF_SBB(H,GetH) DEF_SBB(L,GetL)
static int _SbbM(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetHL())+GetCarry(),MINUS));
    SetA(SetTemp(GetA()-GetMemByte(GetHL())-GetCarry()) & LARGEST_INT);
    Set8085Flag(); return SBB_LEN; }
static int _Sbi(void) {
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),GetMemByte(GetIP()+1)+GetCarry(),MINUS));
    SetTemp(GetA()-GetMemByte(GetIP()+1)-GetCarry());
    SetA(GetTemp() & LARGEST_INT); Set8085Flag(); return SBI_LEN; }

/* INR/DCR */
#define DEF_INR(reg,get,set) \
static int _Inr##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(get(),1,PLUS)); \
    set(SetTemp(get()+1) & LARGEST_INT); \
    SetSign(GetTemp()&0x80?1:0); SetZero(GetTemp()==0?1:0); \
    SetParity(ComputeParity(GetTemp())); return INR_LEN; }
DEF_INR(A,GetA,SetA) DEF_INR(B,GetB,SetB) DEF_INR(C,GetC,SetC) DEF_INR(D,GetD,SetD)
DEF_INR(E,GetE,SetE) DEF_INR(H,GetH,SetH) DEF_INR(L,GetL,SetL)
static int _InrM(void) {
    uchar v = GetMemByte(GetHL());
    SetAuxCarry(ShouldSetAuxillaryFlag(v,1,PLUS));
    SetTemp(v+1); SetMemByte(GetHL(), GetTemp()&LARGEST_INT);
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0);
    SetParity(ComputeParity(GetTemp())); return INR_LEN; }

#define DEF_DCR(reg,get,set) \
static int _Dcr##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(get(),1,MINUS)); \
    set(SetTemp(get()-1) & LARGEST_INT); \
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0); \
    SetParity(ComputeParity(GetTemp())); return DCR_LEN; }
DEF_DCR(A,GetA,SetA) DEF_DCR(B,GetB,SetB) DEF_DCR(C,GetC,SetC) DEF_DCR(D,GetD,SetD)
DEF_DCR(E,GetE,SetE) DEF_DCR(H,GetH,SetH) DEF_DCR(L,GetL,SetL)
static int _DcrM(void) {
    uchar v = GetMemByte(GetHL());
    SetAuxCarry(ShouldSetAuxillaryFlag(v,1,MINUS));
    SetTemp(v-1); SetMemByte(GetHL(), GetTemp()&LARGEST_INT);
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0);
    SetParity(ComputeParity(GetTemp())); return DCR_LEN; }

/* INX/DCX */
#define DEF_INX(name,get,set) \
static int _Inx##name(void) { set(get()+1); return INX_LEN; }
#define DEF_DCX(name,get,set) \
static int _Dcx##name(void) { set(get()-1); return DCX_LEN; }
static void SetBC(word v) { SetB(v>>8); SetC(v&0xFF); }
static void SetDE(word v) { SetD(v>>8); SetE(v&0xFF); }
static void SetHL(word v) { SetH(v>>8); SetL(v&0xFF); }
DEF_INX(B,GetBC,SetBC) DEF_INX(D,GetDE,SetDE) DEF_INX(H,GetHL,SetHL)
static int _InxSP(void) { SetSP(GetSP()+1); return INX_LEN; }
DEF_DCX(B,GetBC,SetBC) DEF_DCX(D,GetDE,SetDE) DEF_DCX(H,GetHL,SetHL)
static int _DcxSP(void) { SetSP(GetSP()-1); return DCX_LEN; }

/* DAD */
#define DEF_DAD(name,get_pair) \
static int _Dad##name(void) { \
    dword r = (dword)GetHL() + (dword)get_pair(); \
    SetCarry(r > 0xFFFF ? 1 : 0); \
    SetH((r>>8)&0xFF); SetL(r&0xFF); return DAD_LEN; }
DEF_DAD(B,GetBC) DEF_DAD(D,GetDE) DEF_DAD(H,GetHL)
static int _DadSP(void) {
    dword r = (dword)GetHL()+(dword)GetSP();
    SetCarry(r>0xFFFF?1:0); SetH((r>>8)&0xFF); SetL(r&0xFF); return DAD_LEN; }

/* DAA */
static int _Daa(void) {
    int a = GetA(), cy = GetCarry(), ac = GetAuxCarry();
    int correction = 0;
    if (ac || (a & 0x0F) > 9) { correction |= 0x06; }
    if (cy || a > 0x99)       { correction |= 0x60; SetCarry(1); }
    a += correction;
    SetA(a & 0xFF);
    SetSign(a & 0x80 ? 1 : 0);
    SetZero((a & 0xFF) == 0 ? 1 : 0);
    SetParity(ComputeParity(a));
    return DAA_LEN; }

/* --- Logical: ANA/ORA/XRA/CMP --- */
#define DEF_ANA(reg,get) \
static int _Ana##reg(void) { \
    SetAuxCarry(((GetA()|get())&0x08)?1:0); \
    SetA(GetA()&get()); SetTemp(GetA()); SetCarry(0); \
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0); \
    SetParity(ComputeParity(GetA())); return ANA_LEN; }
DEF_ANA(A,GetA) DEF_ANA(B,GetB) DEF_ANA(C,GetC) DEF_ANA(D,GetD)
DEF_ANA(E,GetE) DEF_ANA(H,GetH) DEF_ANA(L,GetL)
static int _AnaM(void) { return _AnaA(); /* reuse with M */ }
/* overwrite _AnaM properly */
#undef DEF_ANA
static int _AnaM2(void) {
    uchar v = GetMemByte(GetHL());
    SetAuxCarry(((GetA()|v)&0x08)?1:0);
    SetA(GetA()&v); SetCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return ANA_LEN; }
static int _Ani(void) {
    uchar v = GetMemByte(GetIP()+1);
    SetAuxCarry(((GetA()|v)&0x08)?1:0);
    SetA(GetA()&v); SetCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return ANI_LEN; }

#define DEF_ORA(reg,get) \
static int _Ora##reg(void) { \
    SetA(GetA()|get()); SetCarry(0); SetAuxCarry(0); \
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0); \
    SetParity(ComputeParity(GetA())); return ORA_LEN; }
DEF_ORA(A,GetA) DEF_ORA(B,GetB) DEF_ORA(C,GetC) DEF_ORA(D,GetD)
DEF_ORA(E,GetE) DEF_ORA(H,GetH) DEF_ORA(L,GetL)
static int _OraM(void) {
    SetA(GetA()|GetMemByte(GetHL())); SetCarry(0); SetAuxCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return ORA_LEN; }
static int _Ori(void) {
    SetA(GetA()|GetMemByte(GetIP()+1)); SetCarry(0); SetAuxCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return ORI_LEN; }

#define DEF_XRA(reg,get) \
static int _Xra##reg(void) { \
    SetA(GetA()^get()); SetCarry(0); SetAuxCarry(0); \
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0); \
    SetParity(ComputeParity(GetA())); return XRA_LEN; }
DEF_XRA(A,GetA) DEF_XRA(B,GetB) DEF_XRA(C,GetC) DEF_XRA(D,GetD)
DEF_XRA(E,GetE) DEF_XRA(H,GetH) DEF_XRA(L,GetL)
static int _XraM(void) {
    SetA(GetA()^GetMemByte(GetHL())); SetCarry(0); SetAuxCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return XRA_LEN; }
static int _Xri(void) {
    SetA(GetA()^GetMemByte(GetIP()+1)); SetCarry(0); SetAuxCarry(0);
    SetSign(GetA()&0x80?1:0); SetZero(GetA()==0?1:0);
    SetParity(ComputeParity(GetA())); return XRI_LEN; }

#define DEF_CMP(reg,get) \
static int _Cmp##reg(void) { \
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),get(),MINUS)); \
    SetTemp(GetA()-get()); \
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0); \
    SetParity(ComputeParity(GetTemp())); SetCarry(GetA()<get()?1:0); return CMP_LEN; }
DEF_CMP(A,GetA) DEF_CMP(B,GetB) DEF_CMP(C,GetC) DEF_CMP(D,GetD)
DEF_CMP(E,GetE) DEF_CMP(H,GetH) DEF_CMP(L,GetL)
static int _CmpM(void) {
    uchar v = GetMemByte(GetHL());
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),v,MINUS));
    SetTemp(GetA()-v);
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0);
    SetParity(ComputeParity(GetTemp())); SetCarry(GetA()<v?1:0); return CMP_LEN; }
static int _Cpi(void) {
    uchar v = GetMemByte(GetIP()+1);
    SetAuxCarry(ShouldSetAuxillaryFlag(GetA(),v,MINUS));
    SetTemp(GetA()-v);
    SetSign(GetTemp()&0x80?1:0); SetZero((GetTemp()&0xFF)==0?1:0);
    SetParity(ComputeParity(GetTemp())); SetCarry(GetA()<v?1:0); return CPI_LEN; }

/* CMA, CMC, STC */
static int _Cma(void) { SetA(~GetA()&0xFF); return CMA_LEN; }
static int _Cmc(void) { SetCarry(!GetCarry()); return CMC_LEN; }
static int _Stc(void) { SetCarry(1); return STC_LEN; }

/* Rotate */
static int _Rlc(void) {
    int b7 = (GetA()>>7)&1;
    SetA(((GetA()<<1)|b7)&0xFF); SetCarry(b7); return RLC_LEN; }
static int _Rrc(void) {
    int b0 = GetA()&1;
    SetA(((GetA()>>1)|(b0<<7))&0xFF); SetCarry(b0); return RRC_LEN; }
static int _Ral(void) {
    int b7 = (GetA()>>7)&1, cy = GetCarry();
    SetA(((GetA()<<1)|cy)&0xFF); SetCarry(b7); return RAL_LEN; }
static int _Rar(void) {
    int b0 = GetA()&1, cy = GetCarry();
    SetA(((GetA()>>1)|(cy<<7))&0xFF); SetCarry(b0); return RAR_LEN; }

/* --- Branch instructions --- */
static int _Jmp(void)  { SetIP(GetMemWord(GetIP()+1)); return 0; }

#define DEF_JCC(name,cond) \
static int _J##name(void) { \
    if (cond) { SetIP(GetMemWord(GetIP()+1)); return 0; } return JMP_LEN; }
DEF_JCC(nz, !GetZero())  DEF_JCC(z,  GetZero())
DEF_JCC(nc, !GetCarry()) DEF_JCC(c,  GetCarry())
DEF_JCC(po, !GetParity())DEF_JCC(pe, GetParity())
DEF_JCC(p,  !GetSign())  DEF_JCC(m,  GetSign())

static int _Call(void) {
    word ret = GetIP() + CALL_LEN;
    StackPush(ret);
    SetIP(GetMemWord(GetIP()+1));
    SET_STATUS(JUST_CALLED);
    return 0; }

#define DEF_CC(name,cond) \
static int _C##name(void) { \
    if (cond) { word ret=GetIP()+CALL_LEN; StackPush(ret); \
                SetIP(GetMemWord(GetIP()+1)); SET_STATUS(JUST_CALLED); return 0; } \
    return CALL_LEN; }
DEF_CC(nz,!GetZero())  DEF_CC(z, GetZero())
DEF_CC(nc,!GetCarry()) DEF_CC(c, GetCarry())
DEF_CC(po,!GetParity())DEF_CC(pe,GetParity())
DEF_CC(p, !GetSign())  DEF_CC(m, GetSign())

static int _Ret(void) {
    SetIP(StackPop());
    SET_STATUS(JUST_RETURNED);
    return 0; }

#define DEF_RC(name,cond) \
static int _R##name(void) { \
    if (cond) { SetIP(StackPop()); SET_STATUS(JUST_RETURNED); return 0; } \
    return RET_LEN; }
DEF_RC(nz,!GetZero())  DEF_RC(z, GetZero())
DEF_RC(nc,!GetCarry()) DEF_RC(c, GetCarry())
DEF_RC(po,!GetParity())DEF_RC(pe,GetParity())
DEF_RC(p, !GetSign())  DEF_RC(m, GetSign())

/* RST n */
#define DEF_RST(n,addr) \
static int _Rst##n(void) { StackPush(GetIP()+RST_LEN); SetIP(addr); return 0; }
DEF_RST(0,RST_0_ADDR) DEF_RST(1,RST_1_ADDR) DEF_RST(2,RST_2_ADDR)
DEF_RST(3,RST_3_ADDR) DEF_RST(4,RST_4_ADDR) DEF_RST(5,RST_5_ADDR)
DEF_RST(6,RST_6_ADDR) DEF_RST(7,RST_7_ADDR)

/* PCHL */
static int _Pchl(void) { SetIP(GetHL()); return 0; }

/* IN/OUT — backed by KIT->cpu.input_ports / output_ports */
static int _In(void) {
    uchar port = GetMemByte(GetIP() + 1);
    SetA(KIT->cpu.input_ports[port]);
    return IN_LEN;
}
static int _Out(void) {
    uchar port = GetMemByte(GetIP() + 1);
    uchar val  = GetA();
    KIT->cpu.output_ports[port] = val;
    if (g_out_callback) g_out_callback(port, val);
    return OUT_LEN;
}

/* RIM — read interrupt mask into A */
static int _Rim(void) {
    interrupt_struct *is = &INTR();
    uchar a = (is->int_mask & 0x07)        /* bits 0-2: mask state */
            | (is->rst_5_5_ff ? 0x08 : 0)  /* bit 3: RST 5.5 pending */
            | (is->rst_6_5_ff ? 0x10 : 0)  /* bit 4: RST 6.5 pending */
            | (is->rst_7_5_ff ? 0x20 : 0)  /* bit 5: RST 7.5 pending */
            | (is->ei         ? 0x40 : 0)  /* bit 6: IFF */
            | (g_sid          ? 0x80 : 0); /* bit 7: SID */
    SetA(a);
    return RIM_LEN;
}
/* SIM — set interrupt mask from A */
static int _Sim(void) {
    interrupt_struct *is = &INTR();
    uchar a = GetA();
    if (a & 0x08) {  /* MSE bit: update masks */
        is->int_mask = (is->int_mask & ~0x07) | (a & 0x07);
    }
    if (a & 0x10) is->rst_7_5_ff = 0;  /* reset RST 7.5 edge latch */
    if (a & 0x40) g_sod = (a >> 7) & 1; /* SODE bit: update SOD */
    return SIM_LEN;
}

/* Invalid opcode */
static int _Invalid(void) { SET_STATUS(INVALID_OP|SEVERE_ERROR); return 1; }

/* -----------------------------------------------------------------------
 * System calls (CALL 5 interface - Intel SDK)
 * --------------------------------------------------------------------- */

/* 7-segment encoding */
int NumTo7Seg(int n) {
    static const int table[] = {
        _LED_0,_LED_1,_LED_2,_LED_3,_LED_4,_LED_5,_LED_6,_LED_7,
        _LED_8,_LED_9,_LED_A,_LED_B,_LED_C,_LED_D,_LED_E,_LED_F
    };
    n &= 0xF;
    return table[n];
}

static void notify_led(void) {
    if (!g_led_callback) return;
    int i;
    for (i = 0; i < MAX_STATUS_FIELDS; i++)
        g_led_callback(0, i, STATUS_FIELD(i));
    for (i = 0; i < MAX_ADDR_FIELDS; i++)
        g_led_callback(1, i, ADDR_FIELD(i));
    for (i = 0; i < MAX_DATA_FIELDS; i++)
        g_led_callback(2, i, DATA_FIELD(i));
}

int DisplayAllLeds(void)  { notify_led(); return 1; }
int BlankAddressLed(void) {
    int i; for(i=0;i<MAX_ADDR_FIELDS;i++) ADDR_FIELD(i)=_LED_BLANK;
    notify_led(); return 1; }
int BlankDataLed(void) {
    int i; for(i=0;i<MAX_DATA_FIELDS;i++) DATA_FIELD(i)=_LED_BLANK;
    notify_led(); return 1; }
int BlankStatusLed(void) {
    int i; for(i=0;i<MAX_STATUS_FIELDS;i++) STATUS_FIELD(i)=_LED_BLANK;
    notify_led(); return 1; }
int BlankAllLeds(void) {
    BlankAddressLed(); BlankDataLed(); BlankStatusLed(); return 1; }

int PerformSystemCall(void) {
    /*
     * The Intel SDK CALL 5 interface.
     * Register C holds the function number.
     * This implements the key display/keyboard calls used by example programs.
     */
    int c = GetC();
    switch (c) {
        case 0x00: /* System reset */
            return 1;
        case 0x01: { /* Read hex key into A — dequeue from keyboard queue */
            kbd_queue_struct *kb = &KIT->kbd;
            if (kb->len > 0) {
                SetA(kb->buf[kb->head]);
                kb->head = (kb->head + 1) % KBD_QUEUE_MAX;
                kb->len--;
            } else {
                SetA(0);
            }
            return 1;
        }
        case 0x02: /* Write single hex digit to display */
        {
            int field = GetB();
            if (field == 0) STATUS_FIELD(0) = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 1) STATUS_FIELD(1) = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 2) ADDR_FIELD(0)   = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 3) ADDR_FIELD(1)   = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 4) ADDR_FIELD(2)   = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 5) ADDR_FIELD(3)   = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 6) DATA_FIELD(0)   = NumTo7Seg(GetMemByte(GetHL()));
            else if (field == 7) DATA_FIELD(1)   = NumTo7Seg(GetMemByte(GetHL()));
            DisplayAllLeds();
            return 1;
        }
        case 0x03: /* Display / blank */
            switch (GetB()) {
                case 0: BlankAddressLed(); break;
                case 1: BlankDataLed();    break;
                case 2: BlankStatusLed();  break;
                case 3: BlankAllLeds();    break;
            }
            return 1;
        case 0x09: /* Scroll display one position */
        {
            int i;
            for (i = MAX_ADDR_FIELDS-1; i > 0; i--)
                ADDR_FIELD(i) = ADDR_FIELD(i-1);
            ADDR_FIELD(0) = DATA_FIELD(1);
            DATA_FIELD(1) = DATA_FIELD(0);
            DATA_FIELD(0) = NumTo7Seg(GetD());
            DisplayAllLeds();
            return 1;
        }
        case 0x0B: /* Scroll (SCROLL.85 uses this with A=9) */
        {
            int i;
            int d = GetD();
            for (i = MAX_ADDR_FIELDS-1; i > 0; i--)
                ADDR_FIELD(i) = ADDR_FIELD(i-1);
            ADDR_FIELD(0) = DATA_FIELD(1);
            DATA_FIELD(1) = DATA_FIELD(0);
            DATA_FIELD(0) = NumTo7Seg(d);
            DisplayAllLeds();
            return 1;
        }
        default:
            return BadSystemCall();
    }
}

/* Interrupt handler */
int PerformInterrupt(int num) {
    switch (num) {
        case TRAP_INTR:    StackPush(GetIP()); SetIP(TRAP_ADDR);    break;
        case RST_5_5_INTR: StackPush(GetIP()); SetIP(RST_5_5_ADDR); break;
        case RST_6_5_INTR: StackPush(GetIP()); SetIP(RST_6_5_ADDR); break;
        case RST_7_5_INTR: StackPush(GetIP()); SetIP(RST_7_5_ADDR); break;
        default: return 0;
    }
    return 1;
}

/* -----------------------------------------------------------------------
 * Machine opcode dispatch table  (256 entries)
 * This is the SIMULATE.H table, ported to use the functions above.
 * --------------------------------------------------------------------- */

/* Code-to-string stubs - return length of instruction at addr */
static int str1(unsigned a,int p,char *s){(void)a;(void)p;(void)s;return 1;}
static int str2(unsigned a,int p,char *s){(void)a;(void)p;(void)s;return 2;}
static int str3(unsigned a,int p,char *s){(void)a;(void)p;(void)s;return 3;}

machine_op_struct mot[MAX_INSTRUCTIONS] = {
/* 00 */ {_Nop,    "nop",       str1, NOP_LEN},
/* 01 */ {_LxiB,   "lxi  b,",   str3, LXI_LEN},
/* 02 */ {_StaxB,  "stax b",    str1, STAX_LEN},
/* 03 */ {_InxB,   "inx  b",    str1, INX_LEN},
/* 04 */ {_InrB,   "inr  b",    str1, INR_LEN},
/* 05 */ {_DcrB,   "dcr  b",    str1, DCR_LEN},
/* 06 */ {_MviB,   "mvi  b,",   str2, MVI_LEN},
/* 07 */ {_Rlc,    "rlc",       str1, RLC_LEN},
/* 08 */ {_Invalid,"invalid",   str1, 1},
/* 09 */ {_DadB,   "dad  b",    str1, DAD_LEN},
/* 0A */ {_LdaxB,  "ldax b",    str1, LDAX_LEN},
/* 0B */ {_DcxB,   "dcx  b",    str1, DCX_LEN},
/* 0C */ {_InrC,   "inr  c",    str1, INR_LEN},
/* 0D */ {_DcrC,   "dcr  c",    str1, DCR_LEN},
/* 0E */ {_MviC,   "mvi  c,",   str2, MVI_LEN},
/* 0F */ {_Rrc,    "rrc",       str1, RRC_LEN},
/* 10 */ {_Invalid,"invalid",   str1, 1},
/* 11 */ {_LxiD,   "lxi  d,",   str3, LXI_LEN},
/* 12 */ {_StaxD,  "stax d",    str1, STAX_LEN},
/* 13 */ {_InxD,   "inx  d",    str1, INX_LEN},
/* 14 */ {_InrD,   "inr  d",    str1, INR_LEN},
/* 15 */ {_DcrD,   "dcr  d",    str1, DCR_LEN},
/* 16 */ {_MviD,   "mvi  d,",   str2, MVI_LEN},
/* 17 */ {_Ral,    "ral",       str1, RAL_LEN},
/* 18 */ {_Invalid,"invalid",   str1, 1},
/* 19 */ {_DadD,   "dad  d",    str1, DAD_LEN},
/* 1A */ {_LdaxD,  "ldax d",    str1, LDAX_LEN},
/* 1B */ {_DcxD,   "dcx  d",    str1, DCX_LEN},
/* 1C */ {_InrE,   "inr  e",    str1, INR_LEN},
/* 1D */ {_DcrE,   "dcr  e",    str1, DCR_LEN},
/* 1E */ {_MviE,   "mvi  e,",   str2, MVI_LEN},
/* 1F */ {_Rar,    "rar",       str1, RAR_LEN},
/* 20 */ {_Rim,    "rim",       str1, RIM_LEN},
/* 21 */ {_LxiH,   "lxi  h,",   str3, LXI_LEN},
/* 22 */ {_SHLd,   "shld ",     str3, SHLD_LEN},
/* 23 */ {_InxH,   "inx  h",    str1, INX_LEN},
/* 24 */ {_InrH,   "inr  h",    str1, INR_LEN},
/* 25 */ {_DcrH,   "dcr  h",    str1, DCR_LEN},
/* 26 */ {_MviH,   "mvi  h,",   str2, MVI_LEN},
/* 27 */ {_Daa,    "daa",       str1, DAA_LEN},
/* 28 */ {_Invalid,"invalid",   str1, 1},
/* 29 */ {_DadH,   "dad  h",    str1, DAD_LEN},
/* 2A */ {_LHLd,   "lhld ",     str3, LHLD_LEN},
/* 2B */ {_DcxH,   "dcx  h",    str1, DCX_LEN},
/* 2C */ {_InrL,   "inr  l",    str1, INR_LEN},
/* 2D */ {_DcrL,   "dcr  l",    str1, DCR_LEN},
/* 2E */ {_MviL,   "mvi  l,",   str2, MVI_LEN},
/* 2F */ {_Cma,    "cma",       str1, CMA_LEN},
/* 30 */ {_Sim,    "sim",       str1, SIM_LEN},
/* 31 */ {_LxiSP,  "lxi  sp,",  str3, LXI_LEN},
/* 32 */ {_StA,    "sta  ",     str3, STA_LEN},
/* 33 */ {_InxSP,  "inx  sp",   str1, INX_LEN},
/* 34 */ {_InrM,   "inr  m",    str1, INR_LEN},
/* 35 */ {_DcrM,   "dcr  m",    str1, DCR_LEN},
/* 36 */ {_MviM,   "mvi  m,",   str2, MVI_LEN},
/* 37 */ {_Stc,    "stc",       str1, STC_LEN},
/* 38 */ {_Invalid,"invalid",   str1, 1},
/* 39 */ {_DadSP,  "dad  sp",   str1, DAD_LEN},
/* 3A */ {_LdA,    "lda  ",     str3, LDA_LEN},
/* 3B */ {_DcxSP,  "dcx  sp",   str1, DCX_LEN},
/* 3C */ {_InrA,   "inr  a",    str1, INR_LEN},
/* 3D */ {_DcrA,   "dcr  a",    str1, DCR_LEN},
/* 3E */ {_MviA,   "mvi  a,",   str2, MVI_LEN},
/* 3F */ {_Cmc,    "cmc",       str1, CMC_LEN},
/* 40 */ {_MovBB,  "mov  b,b",  str1, MOV_LEN},
/* 41 */ {_MovBC,  "mov  b,c",  str1, MOV_LEN},
/* 42 */ {_MovBD,  "mov  b,d",  str1, MOV_LEN},
/* 43 */ {_MovBE,  "mov  b,e",  str1, MOV_LEN},
/* 44 */ {_MovBH,  "mov  b,h",  str1, MOV_LEN},
/* 45 */ {_MovBL,  "mov  b,l",  str1, MOV_LEN},
/* 46 */ {_MovBM,  "mov  b,m",  str1, MOV_LEN},
/* 47 */ {_MovBA,  "mov  b,a",  str1, MOV_LEN},
/* 48 */ {_MovCB,  "mov  c,b",  str1, MOV_LEN},
/* 49 */ {_MovCC,  "mov  c,c",  str1, MOV_LEN},
/* 4A */ {_MovCD,  "mov  c,d",  str1, MOV_LEN},
/* 4B */ {_MovCE,  "mov  c,e",  str1, MOV_LEN},
/* 4C */ {_MovCH,  "mov  c,h",  str1, MOV_LEN},
/* 4D */ {_MovCL,  "mov  c,l",  str1, MOV_LEN},
/* 4E */ {_MovCM,  "mov  c,m",  str1, MOV_LEN},
/* 4F */ {_MovCA,  "mov  c,a",  str1, MOV_LEN},
/* 50 */ {_MovDB,  "mov  d,b",  str1, MOV_LEN},
/* 51 */ {_MovDC,  "mov  d,c",  str1, MOV_LEN},
/* 52 */ {_MovDD,  "mov  d,d",  str1, MOV_LEN},
/* 53 */ {_MovDE,  "mov  d,e",  str1, MOV_LEN},
/* 54 */ {_MovDH,  "mov  d,h",  str1, MOV_LEN},
/* 55 */ {_MovDL,  "mov  d,l",  str1, MOV_LEN},
/* 56 */ {_MovDM,  "mov  d,m",  str1, MOV_LEN},
/* 57 */ {_MovDA,  "mov  d,a",  str1, MOV_LEN},
/* 58 */ {_MovEB,  "mov  e,b",  str1, MOV_LEN},
/* 59 */ {_MovEC,  "mov  e,c",  str1, MOV_LEN},
/* 5A */ {_MovED,  "mov  e,d",  str1, MOV_LEN},
/* 5B */ {_MovEE,  "mov  e,e",  str1, MOV_LEN},
/* 5C */ {_MovEH,  "mov  e,h",  str1, MOV_LEN},
/* 5D */ {_MovEL,  "mov  e,l",  str1, MOV_LEN},
/* 5E */ {_MovEM,  "mov  e,m",  str1, MOV_LEN},
/* 5F */ {_MovEA,  "mov  e,a",  str1, MOV_LEN},
/* 60 */ {_MovHB,  "mov  h,b",  str1, MOV_LEN},
/* 61 */ {_MovHC,  "mov  h,c",  str1, MOV_LEN},
/* 62 */ {_MovHD,  "mov  h,d",  str1, MOV_LEN},
/* 63 */ {_MovHE,  "mov  h,e",  str1, MOV_LEN},
/* 64 */ {_MovHH,  "mov  h,h",  str1, MOV_LEN},
/* 65 */ {_MovHL,  "mov  h,l",  str1, MOV_LEN},
/* 66 */ {_MovHM,  "mov  h,m",  str1, MOV_LEN},
/* 67 */ {_MovHA,  "mov  h,a",  str1, MOV_LEN},
/* 68 */ {_MovLB,  "mov  l,b",  str1, MOV_LEN},
/* 69 */ {_MovLC,  "mov  l,c",  str1, MOV_LEN},
/* 6A */ {_MovLD,  "mov  l,d",  str1, MOV_LEN},
/* 6B */ {_MovLE,  "mov  l,e",  str1, MOV_LEN},
/* 6C */ {_MovLH,  "mov  l,h",  str1, MOV_LEN},
/* 6D */ {_MovLL,  "mov  l,l",  str1, MOV_LEN},
/* 6E */ {_MovLM,  "mov  l,m",  str1, MOV_LEN},
/* 6F */ {_MovLA,  "mov  l,a",  str1, MOV_LEN},
/* 70 */ {_MovMB,  "mov  m,b",  str1, MOV_LEN},
/* 71 */ {_MovMC,  "mov  m,c",  str1, MOV_LEN},
/* 72 */ {_MovMD,  "mov  m,d",  str1, MOV_LEN},
/* 73 */ {_MovME,  "mov  m,e",  str1, MOV_LEN},
/* 74 */ {_MovMH,  "mov  m,h",  str1, MOV_LEN},
/* 75 */ {_MovML,  "mov  m,l",  str1, MOV_LEN},
/* 76 */ {_Hlt,    "hlt",       str1, HLT_LEN},
/* 77 */ {_MovMA,  "mov  m,a",  str1, MOV_LEN},
/* 78 */ {_MovAB,  "mov  a,b",  str1, MOV_LEN},
/* 79 */ {_MovAC,  "mov  a,c",  str1, MOV_LEN},
/* 7A */ {_MovAD,  "mov  a,d",  str1, MOV_LEN},
/* 7B */ {_MovAE,  "mov  a,e",  str1, MOV_LEN},
/* 7C */ {_MovAH,  "mov  a,h",  str1, MOV_LEN},
/* 7D */ {_MovAL,  "mov  a,l",  str1, MOV_LEN},
/* 7E */ {_MovAM,  "mov  a,m",  str1, MOV_LEN},
/* 7F */ {_MovAA,  "mov  a,a",  str1, MOV_LEN},
/* 80 */ {_AddB,   "add  b",    str1, ADD_LEN},
/* 81 */ {_AddC,   "add  c",    str1, ADD_LEN},
/* 82 */ {_AddD,   "add  d",    str1, ADD_LEN},
/* 83 */ {_AddE,   "add  e",    str1, ADD_LEN},
/* 84 */ {_AddH,   "add  h",    str1, ADD_LEN},
/* 85 */ {_AddL,   "add  l",    str1, ADD_LEN},
/* 86 */ {_AddM,   "add  m",    str1, ADD_LEN},
/* 87 */ {_AddA,   "add  a",    str1, ADD_LEN},
/* 88 */ {_AdcB,   "adc  b",    str1, ADC_LEN},
/* 89 */ {_AdcC,   "adc  c",    str1, ADC_LEN},
/* 8A */ {_AdcD,   "adc  d",    str1, ADC_LEN},
/* 8B */ {_AdcE,   "adc  e",    str1, ADC_LEN},
/* 8C */ {_AdcH,   "adc  h",    str1, ADC_LEN},
/* 8D */ {_AdcL,   "adc  l",    str1, ADC_LEN},
/* 8E */ {_AdcM,   "adc  m",    str1, ADC_LEN},
/* 8F */ {_AdcA,   "adc  a",    str1, ADC_LEN},
/* 90 */ {_SubB,   "sub  b",    str1, SUB_LEN},
/* 91 */ {_SubC,   "sub  c",    str1, SUB_LEN},
/* 92 */ {_SubD,   "sub  d",    str1, SUB_LEN},
/* 93 */ {_SubE,   "sub  e",    str1, SUB_LEN},
/* 94 */ {_SubH,   "sub  h",    str1, SUB_LEN},
/* 95 */ {_SubL,   "sub  l",    str1, SUB_LEN},
/* 96 */ {_SubM,   "sub  m",    str1, SUB_LEN},
/* 97 */ {_SubA,   "sub  a",    str1, SUB_LEN},
/* 98 */ {_SbbB,   "sbb  b",    str1, SBB_LEN},
/* 99 */ {_SbbC,   "sbb  c",    str1, SBB_LEN},
/* 9A */ {_SbbD,   "sbb  d",    str1, SBB_LEN},
/* 9B */ {_SbbE,   "sbb  e",    str1, SBB_LEN},
/* 9C */ {_SbbH,   "sbb  h",    str1, SBB_LEN},
/* 9D */ {_SbbL,   "sbb  l",    str1, SBB_LEN},
/* 9E */ {_SbbM,   "sbb  m",    str1, SBB_LEN},
/* 9F */ {_SbbA,   "sbb  a",    str1, SBB_LEN},
/* A0 */ {_AnaB,   "ana  b",    str1, ANA_LEN},
/* A1 */ {_AnaC,   "ana  c",    str1, ANA_LEN},
/* A2 */ {_AnaD,   "ana  d",    str1, ANA_LEN},
/* A3 */ {_AnaE,   "ana  e",    str1, ANA_LEN},
/* A4 */ {_AnaH,   "ana  h",    str1, ANA_LEN},
/* A5 */ {_AnaL,   "ana  l",    str1, ANA_LEN},
/* A6 */ {_AnaM2,  "ana  m",    str1, ANA_LEN},
/* A7 */ {_AnaA,   "ana  a",    str1, ANA_LEN},
/* A8 */ {_XraB,   "xra  b",    str1, XRA_LEN},
/* A9 */ {_XraC,   "xra  c",    str1, XRA_LEN},
/* AA */ {_XraD,   "xra  d",    str1, XRA_LEN},
/* AB */ {_XraE,   "xra  e",    str1, XRA_LEN},
/* AC */ {_XraH,   "xra  h",    str1, XRA_LEN},
/* AD */ {_XraL,   "xra  l",    str1, XRA_LEN},
/* AE */ {_XraM,   "xra  m",    str1, XRA_LEN},
/* AF */ {_XraA,   "xra  a",    str1, XRA_LEN},
/* B0 */ {_OraB,   "ora  b",    str1, ORA_LEN},
/* B1 */ {_OraC,   "ora  c",    str1, ORA_LEN},
/* B2 */ {_OraD,   "ora  d",    str1, ORA_LEN},
/* B3 */ {_OraE,   "ora  e",    str1, ORA_LEN},
/* B4 */ {_OraH,   "ora  h",    str1, ORA_LEN},
/* B5 */ {_OraL,   "ora  l",    str1, ORA_LEN},
/* B6 */ {_OraM,   "ora  m",    str1, ORA_LEN},
/* B7 */ {_OraA,   "ora  a",    str1, ORA_LEN},
/* B8 */ {_CmpB,   "cmp  b",    str1, CMP_LEN},
/* B9 */ {_CmpC,   "cmp  c",    str1, CMP_LEN},
/* BA */ {_CmpD,   "cmp  d",    str1, CMP_LEN},
/* BB */ {_CmpE,   "cmp  e",    str1, CMP_LEN},
/* BC */ {_CmpH,   "cmp  h",    str1, CMP_LEN},
/* BD */ {_CmpL,   "cmp  l",    str1, CMP_LEN},
/* BE */ {_CmpM,   "cmp  m",    str1, CMP_LEN},
/* BF */ {_CmpA,   "cmp  a",    str1, CMP_LEN},
/* C0 */ {_Rnz,    "rnz",       str1, RET_LEN},
/* C1 */ {_PopB,   "pop  b",    str1, POP_LEN},
/* C2 */ {_Jnz,    "jnz  ",     str3, JMP_LEN},
/* C3 */ {_Jmp,    "jmp  ",     str3, JMP_LEN},
/* C4 */ {_Cnz,    "cnz  ",     str3, CALL_LEN},
/* C5 */ {_PushB,  "push b",    str1, PUSH_LEN},
/* C6 */ {_Adi,    "adi  ",     str2, ADI_LEN},
/* C7 */ {_Rst0,   "rst  0",    str1, RST_LEN},
/* C8 */ {_Rz,     "rz",        str1, RET_LEN},
/* C9 */ {_Ret,    "ret",       str1, RET_LEN},
/* CA */ {_Jz,     "jz   ",     str3, JMP_LEN},
/* CB */ {_Invalid,"invalid",   str1, 1},
/* CC */ {_Cz,     "cz   ",     str3, CALL_LEN},
/* CD */ {_Call,   "call ",     str3, CALL_LEN},
/* CE */ {_Aci,    "aci  ",     str2, ACI_LEN},
/* CF */ {_Rst1,   "rst  1",    str1, RST_LEN},
/* D0 */ {_Rnc,    "rnc",       str1, RET_LEN},
/* D1 */ {_PopD,   "pop  d",    str1, POP_LEN},
/* D2 */ {_Jnc,    "jnc  ",     str3, JMP_LEN},
/* D3 */ {_Out,    "out  ",     str2, OUT_LEN},
/* D4 */ {_Cnc,    "cnc  ",     str3, CALL_LEN},
/* D5 */ {_PushD,  "push d",    str1, PUSH_LEN},
/* D6 */ {_Sui,    "sui  ",     str2, SUI_LEN},
/* D7 */ {_Rst2,   "rst  2",    str1, RST_LEN},
/* D8 */ {_Rc,     "rc",        str1, RET_LEN},
/* D9 */ {_Invalid,"invalid",   str1, 1},
/* DA */ {_Jc,     "jc   ",     str3, JMP_LEN},
/* DB */ {_In,     "in   ",     str2, IN_LEN},
/* DC */ {_Cc,     "cc   ",     str3, CALL_LEN},
/* DD */ {_Invalid,"invalid",   str1, 1},
/* DE */ {_Sbi,    "sbi  ",     str2, SBI_LEN},
/* DF */ {_Rst3,   "rst  3",    str1, RST_LEN},
/* E0 */ {_Rpo,    "rpo",       str1, RET_LEN},
/* E1 */ {_PopH,   "pop  h",    str1, POP_LEN},
/* E2 */ {_Jpo,    "jpo  ",     str3, JMP_LEN},
/* E3 */ {_Xthl,   "xthl",      str1, XTHL_LEN},
/* E4 */ {_Cpo,    "cpo  ",     str3, CALL_LEN},
/* E5 */ {_PushH,  "push h",    str1, PUSH_LEN},
/* E6 */ {_Ani,    "ani  ",     str2, ANI_LEN},
/* E7 */ {_Rst4,   "rst  4",    str1, RST_LEN},
/* E8 */ {_Rpe,    "rpe",       str1, RET_LEN},
/* E9 */ {_Pchl,   "pchl",      str1, 1},
/* EA */ {_Jpe,    "jpe  ",     str3, JMP_LEN},
/* EB */ {_Xchg,   "xchg",      str1, XCHG_LEN},
/* EC */ {_Cpe,    "cpe  ",     str3, CALL_LEN},
/* ED */ {_Invalid,"invalid",   str1, 1},
/* EE */ {_Xri,    "xri  ",     str2, XRI_LEN},
/* EF */ {_Rst5,   "rst  5",    str1, RST_LEN},
/* F0 */ {_Rp,     "rp",        str1, RET_LEN},
/* F1 */ {_PopPsw, "pop  psw",  str1, POP_LEN},
/* F2 */ {_Jp,     "jp   ",     str3, JMP_LEN},
/* F3 */ {_Di,     "di",        str1, DI_LEN},
/* F4 */ {_Cp,     "cp   ",     str3, CALL_LEN},
/* F5 */ {_PushPsw,"push psw",  str1, PUSH_LEN},
/* F6 */ {_Ori,    "ori  ",     str2, ORI_LEN},
/* F7 */ {_Rst6,   "rst  6",    str1, RST_LEN},
/* F8 */ {_Rm,     "rm",        str1, RET_LEN},
/* F9 */ {_Sphl,   "sphl",      str1, SPHL_LEN},
/* FA */ {_Jm,     "jm   ",     str3, JMP_LEN},
/* FB */ {_Ei,     "ei",        str1, EI_LEN},
/* FC */ {_Cm,     "cm   ",     str3, CALL_LEN},
/* FD */ {_Invalid,"invalid",   str1, 1},
/* FE */ {_Cpi,    "cpi  ",     str2, CPI_LEN},
/* FF */ {_Rst7,   "rst  7",    str1, RST_LEN},
};

/* -----------------------------------------------------------------------
 * Two-pass assembler - Lexer (from original LEX.H)
 * --------------------------------------------------------------------- */

static int is_white(char c) { return c == ' ' || c == '\t'; }

static void SkipWhite(void) {
    while (STRING() && is_white(*STRING())) STRING()++;
}

static int IsEnd(char c) { return c == '\0' || c == '\r' || c == '\n'; }

int Advance(int skip_white) {
    char *s;
    int i = 0;

    LAST()[0] = TOKEN()[0]; LAST()[1] = '\0';
    if (skip_white) SkipWhite();
    s = STRING();

    if (!s || IsEnd(*s)) { CURRENT() = EOI; TOKEN()[0] = '\0'; return EOI; }
    if (*s == '\n' || *s == '\r') {
        STRING()++; CURRENT() = EOLN; return EOLN; }
    if (*s == (char)SEMI) {
        CURRENT() = COMMENT; TOKEN()[0] = '\0';
        while (*s && !IsEnd(*s)) s++;
        STRING() = s; return COMMENT; }
    if (*s == ',') {
        STRING()++; CURRENT() = COMMA; TOKEN()[0] = ','; TOKEN()[1] = '\0';
        return COMMA; }
    if (*s == ':') {
        STRING()++; CURRENT() = COLON; TOKEN()[0] = ':'; TOKEN()[1] = '\0';
        return COLON; }

    while (*s && !is_white(*s) && !IsEnd(*s) &&
           *s != ',' && *s != ':' && *s != (char)SEMI && i < TOKEN_SIZE) {
        TOKEN()[i++] = toupper((unsigned char)*s++);
    }
    TOKEN()[i] = '\0';
    STRING() = s;

    if (i == 0) { CURRENT() = EOI; return EOI; }

    /* Check if pure number (starts with digit) */
    if (isdigit((unsigned char)TOKEN()[0])) {
        CURRENT() = NUMBER; return NUMBER;
    }

    CURRENT() = IDENTIFIER;
    return IDENTIFIER;
}

/* Parse number from TOKEN - supports hex (#/H suffix), decimal (D), octal (O), binary (B) */
long StrToNum(void) {
    char *s = TOKEN();
    int len = (int)strlen(s);
    long val = 0;
    int base = DEFAULT_BASE;

    if (len == 0) return __BAD_NUMBER_FORMAT;

    /* Detect suffix */
    char last = toupper((unsigned char)s[len-1]);
    if (last == '#' || last == 'H') { base = 16; len--; }
    else if (last == 'D')           { base = 10; len--; }
    else if (last == 'O')           { base = 8;  len--; }
    else if (last == 'B')           { base = 2;  len--; }

    int i;
    for (i = 0; i < len; i++) {
        char c = toupper((unsigned char)s[i]);
        int digit;
        if      (c >= '0' && c <= '9') digit = c - '0';
        else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
        else return __BAD_NUMBER_FORMAT;
        if (digit >= base) return __BAD_NUMBER_FORMAT;
        val = val * base + digit;
    }
    return val;
}

/* -----------------------------------------------------------------------
 * Two-pass assembler - Symbol table (from SYMBOL.H)
 * --------------------------------------------------------------------- */

int FindInTable(char *s) {
    int i;
    for (i = 0; i < table.max; i++)
        if (strcmp(table.entry[i].name, s) == 0)
            return (int)table.entry[i].addr;
    return SYMBOL_NOT_FOUND;
}

static int StoreInTable(char *s, unsigned a) {
    int i;
    for (i = 0; i < table.max; i++) {
        if (strcmp(table.entry[i].name, s) == 0) {
            table.entry[i].addr = a;
            return SYMBOL_STORED;
        }
    }
    if (table.max >= TABLE_LENGTH) return SYMBOL_TABLE_FULL;
    strncpy(table.entry[table.max].name, s, LABEL_LEN-1);
    table.entry[table.max].name[LABEL_LEN-1] = '\0';
    table.entry[table.max].addr = a;
    table.max++;
    return SYMBOL_STORED;
}

void InitSymbolTable(void) { table.max = 0; }

/* -----------------------------------------------------------------------
 * Assembler code insertion helpers
 * --------------------------------------------------------------------- */

int InsertMachineCode(uchar c) {
    if (PTR() >= MAIN_MEMORY) { SET_STATUS(SEVERE_ERROR); return -1; }
    KIT->cpu.ram[PTR()++] = c;
    return 1;
}

int InsertCodeAnd8Bit(uchar c, char imm) {
    if (PTR()+1 >= MAIN_MEMORY) { SET_STATUS(SEVERE_ERROR); return -1; }
    KIT->cpu.ram[PTR()++] = c;
    KIT->cpu.ram[PTR()++] = (uchar)imm;
    return 2;
}

int InsertCodeAnd16Bit(uchar c, unsigned a) {
    if (PTR()+2 >= MAIN_MEMORY) { SET_STATUS(SEVERE_ERROR); return -1; }
    KIT->cpu.ram[PTR()++] = c;
    KIT->cpu.ram[PTR()++] = (uchar)(a & 0xFF);
    KIT->cpu.ram[PTR()++] = (uchar)(a >> 8);
    return 3;
}

/* -----------------------------------------------------------------------
 * Mnemonic table & register helpers (from MNEMONIC.H / PARSE.H)
 * --------------------------------------------------------------------- */

static const char *reg_names[] = {"B","C","D","E","H","L","M","A","SP","PSW",NULL};
static const int   reg_nums[]  = {_B, _C, _D, _E, _H, _L, _M, _A, _SP, _PSW};

int IsRegs(char *s) {
    int i;
    for (i = 0; reg_names[i]; i++)
        if (strcmp(s, reg_names[i]) == 0) return 1;
    return 0;
}

int IsMem(char *s) { return strcmp(s, "M") == 0; }

int RegNumber(void) {
    int i;
    for (i = 0; reg_names[i]; i++)
        if (strcmp(TOKEN(), reg_names[i]) == 0) return reg_nums[i];
    return -1;
}

int Displacement(int r1v, int r2v) {
    /* MOV displacement: dst*8 + src */
    return r1v * 8 + r2v;
}

/* -----------------------------------------------------------------------
 * Assembler parse functions (from PARSE.H)
 * --------------------------------------------------------------------- */

static int MovParse(void) {
    int mem = 0;
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN()) && !IsMem(TOKEN())) return REG_OR_MEM_EXPECT;
    if (IsMem(TOKEN())) ++mem;
    r1 = RegNumber();
    if (Advance(0) != COMMA) return COMMA_EXPECTED;
    if (Advance(1) != IDENTIFIER || (!IsRegs(TOKEN()) && !IsMem(TOKEN())))
        return REG_OR_MEM_EXPECT;
    if (IsMem(TOKEN()) && mem >= 1) return MEM_TO_MEM_TRANSFER;
    r2 = RegNumber();
    code = (uchar)(MOV_START + Displacement(r1, r2));
    return InsertMachineCode(code);
}

static int MviParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN()) && !IsMem(TOKEN())) return REG_OR_MEM_EXPECT;
    r1 = RegNumber();
    if (Advance(0) != COMMA) return COMMA_EXPECTED;
    {
        int tok = Advance(1);
        if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    }
    if ((X = StrToNum()) == __BAD_NUMBER_FORMAT) return BAD_NUMBER_FORMAT;
    if (X > LARGEST_INT) return LARGE_NUMBER;
    SetImmediate((unsigned)X);
    code = (uchar)(MVI_START + Displacement(r1, 0));
    return InsertCodeAnd8Bit(code, (char)X);
}

static int LxiParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D && r1 != _H && r1 != _SP) return WRONG_REG;
    if (Advance(0) != COMMA) return COMMA_EXPECTED;
    { int tok = Advance(1); if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT; }
    if ((data = (unsigned long)StrToNum()) > DOUBLE_INT) return ADDR_TOO_LARGE;
    {
        uchar start = (r1 == _B) ? 0x01 : (r1 == _D) ? 0x11 : (r1 == _H) ? 0x21 : 0x31;
        return InsertCodeAnd16Bit(start, (unsigned)data);
    }
}

static int LdaxParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D) return WRONG_REG;
    return InsertMachineCode((uchar)(LDAX_START + Displacement(r1, 0)));
}

static int StaxParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D) return WRONG_REG;
    return InsertMachineCode((uchar)(STAX_START + Displacement(r1, 0)));
}

static int LdaParse(void) {
    int tok = Advance(1); if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
    return InsertCodeAnd16Bit(LDA_START, (unsigned)data);
}

static int StaParse(void) {
    int tok = Advance(1); if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
    return InsertCodeAnd16Bit(STA_START, (unsigned)data);
}

static int LHLdParse(void) {
    int tok = Advance(1); if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
    return InsertCodeAnd16Bit(LHLD_START, (unsigned)data);
}

static int SHLdParse(void) {
    int tok = Advance(1); if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
    return InsertCodeAnd16Bit(SHLD_START, (unsigned)data);
}

static int ImmParse8(uchar op) {
    /* Accept both NUMBER and IDENTIFIER tokens — hex like ffH tokenizes as IDENTIFIER */
    int tok = Advance(1);
    if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((X = StrToNum()) == __BAD_NUMBER_FORMAT) return BAD_NUMBER_FORMAT;
    if (X > LARGEST_INT) return LARGE_NUMBER;
    return InsertCodeAnd8Bit(op, (char)X);
}

static int ImmParse16(uchar op) {
    int tok = Advance(1);
    if (tok != NUMBER && tok != IDENTIFIER) return NUMBER_EXPECT;
    if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
    return InsertCodeAnd16Bit(op, (unsigned)data);
}

/* Parse register-only operand for ANA/ORA/XRA/ADD/ADC/SUB/SBB/CMP */
static int RegOrMemParse(uchar base) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN()) && !IsMem(TOKEN())) return REG_OR_MEM_EXPECT;
    r1 = RegNumber();
    return InsertMachineCode((uchar)(base + r1));
}

/* INR/DCR */
static int InrParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN()) && !IsMem(TOKEN())) return REG_OR_MEM_EXPECT;
    r1 = RegNumber();
    return InsertMachineCode((uchar)(INR_START + Displacement(r1, 0)));
}

static int DcrParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN()) && !IsMem(TOKEN())) return REG_OR_MEM_EXPECT;
    r1 = RegNumber();
    return InsertMachineCode((uchar)(DCR_START + Displacement(r1, 0)));
}

static int InxParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D && r1 != _H && r1 != _SP) return WRONG_REG;
    {
        uchar op = (r1==_B)?0x03:(r1==_D)?0x13:(r1==_H)?0x23:0x33;
        return InsertMachineCode(op);
    }
}

static int DcxParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D && r1 != _H && r1 != _SP) return WRONG_REG;
    {
        uchar op = (r1==_B)?0x0B:(r1==_D)?0x1B:(r1==_H)?0x2B:0x3B;
        return InsertMachineCode(op);
    }
}

static int DadParse(void) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D && r1 != _H && r1 != _SP) return WRONG_REG;
    {
        uchar op = (r1==_B)?0x09:(r1==_D)?0x19:(r1==_H)?0x29:0x39;
        return InsertMachineCode(op);
    }
}

static int PushPopParse(uchar base) {
    if (Advance(1) != IDENTIFIER) return REGISTER_EXPECT;
    if (!IsRegs(TOKEN())) return REGISTER_EXPECT;
    r1 = RegNumber();
    if (r1 != _B && r1 != _D && r1 != _H && r1 != _PSW) return WRONG_REG;
    {
        int idx = (r1==_B)?0:(r1==_D)?1:(r1==_H)?2:3;
        return InsertMachineCode((uchar)(base + idx * 16));
    }
}

static int JmpParse(uchar op) {
    int tok = Advance(1);
    if (tok != IDENTIFIER && tok != NUMBER) return NUMBER_EXPECT;
    if (CURRENT() == NUMBER) {
        if ((data = (unsigned long)StrToNum()) > LARGEST_ADDR) return ADDR_TOO_LARGE;
        return InsertCodeAnd16Bit(op, (unsigned)data);
    }
    /* Label reference */
    {
        int found = FindInTable(TOKEN());
        unsigned a = (found == SYMBOL_NOT_FOUND) ? 0 : (unsigned)found;
        return InsertCodeAnd16Bit(op, a);
    }
}

static int RstParse(void) {
    if (Advance(1) != NUMBER) return NUMBER_EXPECT;
    if ((X = StrToNum()) > 7) return LARGE_NUMBER;
    return InsertMachineCode((uchar)(0xC7 + X * 8));
}

static int InParse(void)  { return ImmParse8(IN_START); }
static int OutParse(void) { return ImmParse8(OUT_START); }

static int NoOperandParse(uchar op) { return InsertMachineCode(op); }

/* -----------------------------------------------------------------------
 * Assembler directives (from DIRECTVE.H)
 * --------------------------------------------------------------------- */

static int NumOrIdTok(void) {
    int t = Advance(1);
    return (t == NUMBER || t == IDENTIFIER) ? t : -1;
}

static int ParseDirective(void) {
    if (strcmp(TOKEN(), "ORG") == 0) {
        if (NumOrIdTok() < 0) return -1;
        data = (unsigned long)StrToNum();
        if ((long)data < 0 || data > LARGEST_ORG) return -1;
        PTR() = (unsigned)data;
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "KICKOFF") == 0) {
        if (NumOrIdTok() < 0) return -1;
        data = (unsigned long)StrToNum();
        if ((long)data < 0 || data > LARGEST_ADDR) return -1;
        SetIP((unsigned)data);
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "SETBYTE") == 0) {
        unsigned addr16; long val;
        if (NumOrIdTok() < 0) return -1;
        addr16 = (unsigned)StrToNum();
        if (Advance(0) != COMMA) return -1;
        if (NumOrIdTok() < 0) return -1;
        val = StrToNum();
        if (val < 0 || val > LARGEST_INT) return -1;
        SetMemByte(addr16, (uchar)val);
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "SETWORD") == 0) {
        unsigned addr16; long val;
        if (NumOrIdTok() < 0) return -1;
        addr16 = (unsigned)StrToNum();
        if (Advance(0) != COMMA) return -1;
        if (NumOrIdTok() < 0) return -1;
        val = StrToNum();
        SetMemWord(addr16, (word)val);
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "DB") == 0) {
        for (;;) {
            SkipWhite();
            char *p = STRING();
            if (!p || IsEnd(*p) || *p == (char)SEMI) break;
            if (*p == '"' || *p == '\'') {
                char q = *p++;
                STRING() = p;
                while (*STRING() && *STRING() != q && !IsEnd(*STRING()))
                    { SetMemByte(PTR(), (uchar)*STRING()); PTR()++; STRING()++; }
                if (*STRING() == q) STRING()++;
            } else {
                if (NumOrIdTok() < 0) return -1;
                SetMemByte(PTR(), (uchar)(StrToNum() & 0xFF)); PTR()++;
            }
            SkipWhite();
            if (!STRING() || *STRING() != ',') break;
            STRING()++;
        }
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "DS") == 0) {
        if (NumOrIdTok() < 0) return -1;
        long n = StrToNum();
        if (n < 0 || n > 65536) return -1;
        for (long i = 0; i < n; i++) { SetMemByte(PTR(), 0); PTR()++; }
        return CORRECT_DIRECTIVE;
    }
    if (strcmp(TOKEN(), "ASSERT") == 0) {
        char subj[TOKEN_SIZE + 2];
        uint8_t sub; int is_pair = 0, is_mem = 0;
        if (NumOrIdTok() < 0) return -1;
        strncpy(subj, TOKEN(), TOKEN_SIZE); subj[TOKEN_SIZE] = '\0';
        if      (strcmp(subj,"B")==0)  sub=0x00;
        else if (strcmp(subj,"C")==0)  sub=0x01;
        else if (strcmp(subj,"D")==0)  sub=0x02;
        else if (strcmp(subj,"E")==0)  sub=0x03;
        else if (strcmp(subj,"H")==0)  sub=0x04;
        else if (strcmp(subj,"L")==0)  sub=0x05;
        else if (strcmp(subj,"M")==0)  sub=0x06;
        else if (strcmp(subj,"A")==0)  sub=0x07;
        else if (strcmp(subj,"CY")==0) sub=0x10;
        else if (strcmp(subj,"Z")==0)  sub=0x11;
        else if (strcmp(subj,"S")==0)  sub=0x12;
        else if (strcmp(subj,"P")==0)  sub=0x13;
        else if (strcmp(subj,"AC")==0) sub=0x14;
        else if (strcmp(subj,"BC")==0) { sub=0x20; is_pair=1; }
        else if (strcmp(subj,"DE")==0) { sub=0x21; is_pair=1; }
        else if (strcmp(subj,"HL")==0) { sub=0x22; is_pair=1; }
        else if (strcmp(subj,"SP")==0) { sub=0x23; is_pair=1; }
        else if (strcmp(subj,"PC")==0) { sub=0x24; is_pair=1; }
        else if (strcmp(subj,"MEM")==0){ sub=0x30; is_mem=1; }
        else return -1;
        if (Advance(0) != COMMA) return -1;
        SetMemByte(PTR(), 0xDD); PTR()++;
        SetMemByte(PTR(), sub);  PTR()++;
        if (is_mem) {
            word addr16; long val8;
            if (NumOrIdTok() < 0) return -1;
            addr16 = (word)StrToNum();
            if (Advance(0) != COMMA) return -1;
            if (NumOrIdTok() < 0) return -1;
            val8 = StrToNum();
            SetMemByte(PTR(), addr16 & 0xFF);        PTR()++;
            SetMemByte(PTR(), (addr16 >> 8) & 0xFF); PTR()++;
            SetMemByte(PTR(), (uchar)(val8 & 0xFF)); PTR()++;
        } else if (is_pair) {
            long val;
            if (NumOrIdTok() < 0) return -1;
            val = StrToNum();
            SetMemByte(PTR(), (word)val & 0xFF);         PTR()++;
            SetMemByte(PTR(), ((word)val >> 8) & 0xFF);  PTR()++;
        } else {
            long val;
            if (NumOrIdTok() < 0) return -1;
            val = StrToNum();
            SetMemByte(PTR(), (uchar)(val & 0xFF)); PTR()++;
        }
        return CORRECT_DIRECTIVE;
    }
    return -1;
}

/* -----------------------------------------------------------------------
 * Mnemonic lookup table  (from MNEMONIC.H)
 * --------------------------------------------------------------------- */

typedef struct { const char *name; int (*parse)(void); } mnem_entry;

static int parse_nop(void)   { return NoOperandParse(0x00); }
static int parse_hlt(void)   { return NoOperandParse(0x76); }
static int parse_ei(void)    { return NoOperandParse(0xFB); }
static int parse_di(void)    { return NoOperandParse(0xF3); }
static int parse_rlc(void)   { return NoOperandParse(0x07); }
static int parse_rrc(void)   { return NoOperandParse(0x0F); }
static int parse_ral(void)   { return NoOperandParse(0x17); }
static int parse_rar(void)   { return NoOperandParse(0x1F); }
static int parse_cma(void)   { return NoOperandParse(0x2F); }
static int parse_cmc(void)   { return NoOperandParse(0x3F); }
static int parse_stc(void)   { return NoOperandParse(0x37); }
static int parse_daa(void)   { return NoOperandParse(0x27); }
static int parse_xchg(void)  { return NoOperandParse(0xEB); }
static int parse_xthl(void)  { return NoOperandParse(0xE3); }
static int parse_sphl(void)  { return NoOperandParse(0xF9); }
static int parse_pchl(void)  { return NoOperandParse(0xE9); }
static int parse_ret(void)   { return NoOperandParse(0xC9); }
static int parse_rim(void)   { return NoOperandParse(0x20); }
static int parse_sim(void)   { return NoOperandParse(0x30); }
static int parse_rnz(void)   { return NoOperandParse(0xC0); }
static int parse_rz(void)    { return NoOperandParse(0xC8); }
static int parse_rnc(void)   { return NoOperandParse(0xD0); }
static int parse_rc(void)    { return NoOperandParse(0xD8); }
static int parse_rpo(void)   { return NoOperandParse(0xE0); }
static int parse_rpe(void)   { return NoOperandParse(0xE8); }
static int parse_rp(void)    { return NoOperandParse(0xF0); }
static int parse_rm(void)    { return NoOperandParse(0xF8); }

static int parse_add(void)  { return RegOrMemParse(ADD_START); }
static int parse_adc(void)  { return RegOrMemParse(ADC_START); }
static int parse_sub(void)  { return RegOrMemParse(SUB_START); }
static int parse_sbb(void)  { return RegOrMemParse(SBB_START); }
static int parse_ana(void)  { return RegOrMemParse(ANA_START); }
static int parse_ora(void)  { return RegOrMemParse(ORA_START); }
static int parse_xra(void)  { return RegOrMemParse(XRA_START); }
static int parse_cmp(void)  { return RegOrMemParse(CMP_START); }

static int parse_adi(void)  { return ImmParse8(ADI_START); }
static int parse_aci(void)  { return ImmParse8(ACI_START); }
static int parse_sui(void)  { return ImmParse8(SUI_START); }
static int parse_sbi(void)  { return ImmParse8(SBI_START); }
static int parse_ani(void)  { return ImmParse8(ANI_START); }
static int parse_ori(void)  { return ImmParse8(ORI_START); }
static int parse_xri(void)  { return ImmParse8(XRI_START); }
static int parse_cpi(void)  { return ImmParse8(CPI_START); }

static int parse_jmp(void)  { return JmpParse(0xC3); }
static int parse_jnz(void)  { return JmpParse(0xC2); }
static int parse_jz(void)   { return JmpParse(0xCA); }
static int parse_jnc(void)  { return JmpParse(0xD2); }
static int parse_jc(void)   { return JmpParse(0xDA); }
static int parse_jpo(void)  { return JmpParse(0xE2); }
static int parse_jpe(void)  { return JmpParse(0xEA); }
static int parse_jp(void)   { return JmpParse(0xF2); }
static int parse_jm(void)   { return JmpParse(0xFA); }

static int parse_call(void) { return JmpParse(0xCD); }
static int parse_cnz(void)  { return JmpParse(0xC4); }
static int parse_cz(void)   { return JmpParse(0xCC); }
static int parse_cnc(void)  { return JmpParse(0xD4); }
static int parse_cc(void)   { return JmpParse(0xDC); }
static int parse_cpo(void)  { return JmpParse(0xE4); }
static int parse_cpe(void)  { return JmpParse(0xEC); }
static int parse_cp(void)   { return JmpParse(0xF4); }
static int parse_cm(void)   { return JmpParse(0xFC); }

static int parse_push(void) { return PushPopParse(PUSH_START); }
static int parse_pop(void)  { return PushPopParse(POP_START); }

static const mnem_entry mnem_table[] = {
    {"NOP",parse_nop},{"HLT",parse_hlt},{"EI",parse_ei},{"DI",parse_di},
    {"MOV",MovParse}, {"MVI",MviParse}, {"LXI",LxiParse},
    {"LDAX",LdaxParse},{"STAX",StaxParse},
    {"LDA",LdaParse}, {"STA",StaParse},
    {"LHLD",LHLdParse},{"SHLD",SHLdParse},
    {"XCHG",parse_xchg},{"XTHL",parse_xthl},{"SPHL",parse_sphl},{"PCHL",parse_pchl},
    {"PUSH",parse_push},{"POP",parse_pop},
    {"ADD",parse_add},{"ADC",parse_adc},{"SUB",parse_sub},{"SBB",parse_sbb},
    {"ANA",parse_ana},{"ORA",parse_ora},{"XRA",parse_xra},{"CMP",parse_cmp},
    {"ADI",parse_adi},{"ACI",parse_aci},{"SUI",parse_sui},{"SBI",parse_sbi},
    {"ANI",parse_ani},{"ORI",parse_ori},{"XRI",parse_xri},{"CPI",parse_cpi},
    {"INR",InrParse}, {"DCR",DcrParse},
    {"INX",InxParse}, {"DCX",DcxParse}, {"DAD",DadParse},
    {"DAA",parse_daa},{"CMA",parse_cma},{"CMC",parse_cmc},{"STC",parse_stc},
    {"RLC",parse_rlc},{"RRC",parse_rrc},{"RAL",parse_ral},{"RAR",parse_rar},
    {"JMP",parse_jmp},{"JNZ",parse_jnz},{"JZ",parse_jz},
    {"JNC",parse_jnc},{"JC",parse_jc},
    {"JPO",parse_jpo},{"JPE",parse_jpe},{"JP",parse_jp},{"JM",parse_jm},
    {"CALL",parse_call},{"CNZ",parse_cnz},{"CZ",parse_cz},
    {"CNC",parse_cnc},{"CC",parse_cc},
    {"CPO",parse_cpo},{"CPE",parse_cpe},{"CP",parse_cp},{"CM",parse_cm},
    {"RET",parse_ret},{"RNZ",parse_rnz},{"RZ",parse_rz},
    {"RNC",parse_rnc},{"RC",parse_rc},
    {"RPO",parse_rpo},{"RPE",parse_rpe},{"RP",parse_rp},{"RM",parse_rm},
    {"RST",RstParse},
    {"IN",InParse},{"OUT",OutParse},
    {"RIM",parse_rim},{"SIM",parse_sim},
    {NULL, NULL}
};

int IsInstruction(void) {
    int i;
    /* Try directive first */
    int dr = ParseDirective();
    if (dr == CORRECT_DIRECTIVE) return CORRECT_DIRECTIVE;

    for (i = 0; mnem_table[i].name; i++) {
        if (strcmp(TOKEN(), mnem_table[i].name) == 0)
            return mnem_table[i].parse();
    }
    return -1;
}

/* -----------------------------------------------------------------------
 * Two-pass assembler main entry points
 * --------------------------------------------------------------------- */

/* Pass 1: collect labels into symbol table, tracking PTR */
long StoreSymbolsInTable(FILE *fp) {
    long count = 0;
    char buf[LINE_LENGTH + 2];
    int tok;

    InitSymbolTable();
    rewind(fp);
    PTR() = DEFAULT_KICKOFF;
    SetIP(DEFAULT_IP);

    while (fgets(buf, sizeof(buf), fp)) {
        LINE_NUMBER()++;
        STRING() = buf;

        tok = Advance(1);
        if (tok == EOI || tok == EOLN || tok == COMMENT) continue;

        if (tok == IDENTIFIER) {
            char saved[TOKEN_SIZE + 2];
            strncpy(saved, TOKEN(), TOKEN_SIZE);
            saved[TOKEN_SIZE] = '\0';
            char *saved_str = STRING();
            int next = Advance(0);
            if (next == COLON) {
                /* Label: record current PTR as its address */
                StoreInTable(saved, PTR());
                tok = Advance(1); /* get instruction after label */
                if (tok == EOI || tok == EOLN || tok == COMMENT) continue;
            } else if (next == IDENTIFIER && strcmp(TOKEN(), "EQU") == 0) {
                /* EQU constant: NAME EQU value */
                if (NumOrIdTok() >= 0) StoreInTable(saved, (unsigned)StrToNum());
                continue;
            } else {
                /* Not a label - restore */
                strncpy(TOKEN(), saved, TOKEN_SIZE);
                STRING() = saved_str;
                CURRENT() = IDENTIFIER;
                tok = IDENTIFIER;
            }
        }

        /* Run IsInstruction to advance PTR and track directive addresses */
        if (tok == IDENTIFIER) {
            int r = IsInstruction();
            if (r == CORRECT_DIRECTIVE) continue;
            if (r > 0) count++;
            /* If r < 0 (error) in pass 1, we silently ignore - pass 2 will report it */
        }
    }
    return count;
}

/* Pass 2: emit machine code */
int ParseLex(void) {
    int tok = Advance(1);

    if (tok == EOI || tok == EOLN) return tok;
    if (tok == COMMENT) return COMMENT;
    if (tok == NUMBER) return NUMBER_EXPECT; /* bare number is illegal */

    if (tok == IDENTIFIER) {
        char saved[TOKEN_SIZE + 2];
        strncpy(saved, TOKEN(), TOKEN_SIZE);
        char *saved_str = STRING();

        int next = Advance(0);
        if (next == COLON) {
            /* Label definition - update with current PTR */
            StoreInTable(saved, PTR());
            /* Continue: there may be an instruction on the same line */
            tok = Advance(1);
            if (tok == EOI || tok == EOLN || tok == COMMENT) return LABEL;
            /* fall through to parse the instruction */
        } else if (next == IDENTIFIER && strcmp(TOKEN(), "EQU") == 0) {
            /* EQU constant: NAME EQU value — update symbol, emit nothing */
            if (NumOrIdTok() >= 0) StoreInTable(saved, (unsigned)StrToNum());
            return CORRECT_DIRECTIVE;
        } else {
            /* Not a label - restore and parse as instruction */
            strncpy(TOKEN(), saved, TOKEN_SIZE);
            STRING() = saved_str;
            CURRENT() = IDENTIFIER;
        }

        int ret = IsInstruction();
        if (ret < 0) return ret;
        return ret;
    }
    return -1;
}

/* -----------------------------------------------------------------------
 * Disassembler: opcode → mnemonic string
 * --------------------------------------------------------------------- */
int GetStringFromCode(unsigned a, char *s) {
    if (a >= MAIN_MEMORY) { strcpy(s, "???"); return 1; }
    uchar op = KIT->cpu.ram[a];
    int len = mot[op].length;
    switch (len) {
        case 1:
            sprintf(s, "%04X  %02X        %s", a, op, mot[op].name);
            break;
        case 2:
            sprintf(s, "%04X  %02X %02X     %s%02XH",
                a, op, KIT->cpu.ram[a+1], mot[op].name, KIT->cpu.ram[a+1]);
            break;
        case 3:
            sprintf(s, "%04X  %02X %02X %02X  %s%02X%02XH",
                a, op, KIT->cpu.ram[a+1], KIT->cpu.ram[a+2], mot[op].name,
                KIT->cpu.ram[a+2], KIT->cpu.ram[a+1]);
            break;
        default:
            sprintf(s, "%04X  %02X        %s", a, op, mot[op].name);
            len = 1;
    }
    return len;
}

/* -----------------------------------------------------------------------
 * Step / Run (the execution engine)
 * --------------------------------------------------------------------- */

/* Check and service pending interrupts (called after each instruction and in halt-wait) */
static void CheckInterrupts(void) {
    if (GET_STATUS() & (QUIT | SEVERE_ERROR)) return;

    interrupt_struct *is = &INTR();

    if (GET_STATUS() & HALTED) {
        /* HLT halt-wait: only TRAP resumes unconditionally; others need IFF */
        if (!is->trap_pend && !is->ei) return;
    } else {
        /* EI delay: IFF becomes active one instruction after EI */
        if (is->iff_next) { is->ei = 1; is->iff_next = 0; return; }
        if (!is->trap_pend && !is->ei) return;
    }

    /* TRAP: non-maskable */
    if (is->trap_pend) {
        is->trap_pend = 0;
        CLEAR_STATUS(HALTED);
        is->ei = 0; is->iff_next = 0;
        StackPush(GetIP()); SetIP(TRAP_ADDR);
        return;
    }

    if (!is->ei) return;  /* maskable interrupts require IFF */

    /* RST 7.5 — edge-triggered latch, masked by int_mask bit 2 */
    if (is->rst_7_5_ff && !(is->int_mask & 0x04)) {
        is->rst_7_5_ff = 0;
        CLEAR_STATUS(HALTED);
        is->ei = 0; is->iff_next = 0;
        StackPush(GetIP()); SetIP(RST_7_5_ADDR);
        return;
    }
    /* RST 6.5 — level, masked by int_mask bit 1 */
    if (is->rst_6_5_ff && !(is->int_mask & 0x02)) {
        CLEAR_STATUS(HALTED);
        is->ei = 0; is->iff_next = 0;
        StackPush(GetIP()); SetIP(RST_6_5_ADDR);
        return;
    }
    /* RST 5.5 — level, masked by int_mask bit 0 */
    if (is->rst_5_5_ff && !(is->int_mask & 0x01)) {
        CLEAR_STATUS(HALTED);
        is->ei = 0; is->iff_next = 0;
        StackPush(GetIP()); SetIP(RST_5_5_ADDR);
        return;
    }
}

/* Execute one instruction (raw — no interrupt check). Returns 1=continue, 0=stop. */
int sim_step_one(void) {
    if (GET_STATUS() & (QUIT | SEVERE_ERROR | HALTED)) return 0;

    /* Check for CALL 5 (system call) */
    uchar op = GetIPByte();
    if (op == 0xCD) { /* CALL */
        word target = GetMemWord(GetIP() + 1);
        if (target == 0x0005) {
            word ret_addr = GetIP() + CALL_LEN;
            PerformSystemCall();
            SetIP(ret_addr);
            return !(GET_STATUS() & (QUIT | SEVERE_ERROR));
        }
    }

    /* ASSERT pseudo-instruction (opcode 0xDD) */
    if (op == 0xDD) {
        uchar sub = GetMemByte(GetIP() + 1);
        word pc = GetIP();
        int incr2 = 2, fail = 0;
        char msg[128] = "";
        if (sub <= 0x07) {
            uchar rv[] = {GetB(),GetC(),GetD(),GetE(),GetH(),GetL(),GetMemByte(GetHL()),GetA()};
            const char *rn[] = {"B","C","D","E","H","L","M","A"};
            uchar exp = GetMemByte(GetIP()+2); incr2 = 3;
            if (rv[sub] != exp) { fail=1; snprintf(msg,sizeof(msg),"%s=%02XH got %02XH",rn[sub],exp,rv[sub]); }
        } else if (sub >= 0x10 && sub <= 0x14) {
            const char *fn[] = {"CY","Z","S","P","AC"};
            uchar f = GetFlag();
            uchar fv[] = {f&1,(f>>6)&1,(f>>7)&1,(f>>2)&1,(f>>4)&1};
            uchar exp = GetMemByte(GetIP()+2)&1; incr2 = 3;
            if (fv[sub-0x10] != exp) { fail=1; snprintf(msg,sizeof(msg),"%s=%u got %u",fn[sub-0x10],exp,fv[sub-0x10]); }
        } else if (sub >= 0x20 && sub <= 0x24) {
            const char *pn[] = {"BC","DE","HL","SP","PC"};
            word pv[] = {GetBC(),GetDE(),GetHL(),GetSP(),pc};
            word exp = (word)(GetMemByte(GetIP()+2)|((word)GetMemByte(GetIP()+3)<<8)); incr2 = 4;
            if (pv[sub-0x20] != exp) { fail=1; snprintf(msg,sizeof(msg),"%s=%04XH got %04XH",pn[sub-0x20],exp,pv[sub-0x20]); }
        } else if (sub == 0x30) {
            word addr = (word)(GetMemByte(GetIP()+2)|((word)GetMemByte(GetIP()+3)<<8));
            uchar exp = GetMemByte(GetIP()+4); incr2 = 5;
            uchar act = GetMemByte(addr);
            if (act != exp) { fail=1; snprintf(msg,sizeof(msg),"mem[%04XH]=%02XH got %02XH",addr,exp,act); }
        }
        if (fail) {
            snprintf(g_last_error, sizeof(g_last_error), "[%04XH] Assertion failed: %s", pc, msg);
            SET_STATUS(SEVERE_ERROR);
            return 0;
        }
        SetIP(GetIP() + incr2);
        return 1;
    }

    /* Dispatch */
    g_hitcnt[GetIP()]++;
    int incr = mot[op].Simulate();
    CLEAR_STATUS(JUST_CALLED | JUST_RETURNED);
    g_cycles += g_tstates[op];

    if (incr > 0) SetIP(GetIP() + incr);
    /* incr == 0 means IP was set by the instruction (JMP, CALL, RET) */

    return !(GET_STATUS() & (QUIT | SEVERE_ERROR | HALTED));
}

/* Run up to max_steps instructions with interrupt support; returns steps executed */
int sim_run_steps(int max_steps) {
    int steps = 0;
    while (steps < max_steps) {
        if (GET_STATUS() & (QUIT | SEVERE_ERROR)) break;
        if (GET_STATUS() & HALTED) { CheckInterrupts(); break; }
        if (!sim_step_one()) break;
        steps++;
        CheckInterrupts();
        if (IsABreakPoint(GetIP()) >= 0) break;
    }
    return steps;
}

int IsABreakPoint(word a) {
    int i;
    for (i = 0; i < (int)BREAK_PT_CTR(); i++)
        if (BREAK_POINT(i) == a) return i;
    return -1;
}
