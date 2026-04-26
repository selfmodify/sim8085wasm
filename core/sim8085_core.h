#ifndef SIM8085_CORE_H
#define SIM8085_CORE_H

/*
 * sim8085_core.h
 * -----------------------------------------------------------------------
 * Portable core header for the 8085 simulator.
 * Replaces the original DOS-specific include.h / defines.h / typedef.h.
 * No platform dependencies - compiles with GCC, Clang, MSVC, Emscripten.
 *
 * Derived from the original sim8085 by V. Kumar (1995).
 * -----------------------------------------------------------------------
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdint.h>

/* -----------------------------------------------------------------------
 * Basic types
 * --------------------------------------------------------------------- */
typedef unsigned char   uchar;
typedef unsigned int    word;
typedef unsigned long   dword;

/* -----------------------------------------------------------------------
 * Memory & machine constants
 * --------------------------------------------------------------------- */
#define MAIN_MEMORY         (16 * 1024)   /* 16 KB address space */
#define DEFAULT_IP          0x100
#define DEFAULT_KICKOFF     0x100
#define MAX_BREAK_POINTS    255
#define MAX_INSTRUCTIONS    256
#define LABEL_LEN           33
#define TABLE_LENGTH        256
#define TOKEN_SIZE          81
#define LINE_LENGTH         256
#define MAX_ERRORS          25

/* LED display field counts */
#define MAX_ADDR_FIELDS     4
#define MAX_DATA_FIELDS     2
#define MAX_STATUS_FIELDS   2
#define TOTAL_LEDS          8

/* -----------------------------------------------------------------------
 * Numeric limits
 * --------------------------------------------------------------------- */
#define LARGEST_INT         255
#define MAX_INT             LARGEST_INT
#define DOUBLE_INT          65535UL
#define LARGEST_ORG         MAIN_MEMORY
#define LARGEST_ADDR        MAIN_MEMORY

/* -----------------------------------------------------------------------
 * Register indices
 * --------------------------------------------------------------------- */
#define _B      0
#define _C      1
#define _D      2
#define _E      3
#define _H      4
#define _L      5
#define _M      6
#define _A      7
#define _SP     8
#define _FLAGS  9
#define _TEMP   10
#define _PSW    11

/* -----------------------------------------------------------------------
 * Assembler directive tokens
 * --------------------------------------------------------------------- */
#define ORG_DIRECTIVE       1
#define KICKOFF_DIRECTIVE   2
#define SETBYTE_DIRECTIVE   3
#define SETWORD_DIRECTIVE   4
#define DEFAULT_BASE        16

/* -----------------------------------------------------------------------
 * Lexer tokens
 * --------------------------------------------------------------------- */
#define SUCCESS             271
#define EOI                 290
#define EOLN                295
#define COMMENT             296
#define IDENTIFIER          310
#define NUMBER              311
#define COMMA               312
#define KEYWORD             313
#define REGISTER            314
#define SEMI                ';'
#define COLON               ':'
#define FOUND               400
#define SYMBOL_STORED       402
#define LABEL               403
#define CORRECT_DIRECTIVE   500
#define COMMENTS            501
#define VALID_INSTRUCTION   502

/* -----------------------------------------------------------------------
 * Machine status bits  (KIT->status)
 * --------------------------------------------------------------------- */
#define QUIT                0x0001
#define SEVERE_ERROR        0x0002
#define WARNING             0x0004
#define INVALID_OP          0x0008
#define IP_BEYOND_MEMORY    0x0010
#define READ_FAULT          0x0020
#define WRITE_FAULT         0x0040
#define STACK_OVERFLOW      0x0080
#define STACK_UNDERFLOW     0x0100
#define BADSYSTEMCALL       0x0200
#define ANY_ERROR           (SEVERE_ERROR|INVALID_OP|IP_BEYOND_MEMORY| \
                             READ_FAULT|WRITE_FAULT|STACK_OVERFLOW|    \
                             STACK_UNDERFLOW|BADSYSTEMCALL)
#define HALTED              0x0400   /* HLT instruction executed */
#define JUST_RETURNED       0x0800   /* a RET was just executed */
#define JUST_CALLED         0x1000   /* a CALL was just executed */

/* -----------------------------------------------------------------------
 * 8085 flag register bit positions
 * --------------------------------------------------------------------- */
#define CARRY_BIT           0x01
#define PARITY_BIT          0x04
#define AUX_CARRY_BIT       0x10
#define ZERO_BIT            0x40
#define SIGN_BIT            0x80

/* -----------------------------------------------------------------------
 * Interrupt addresses
 * --------------------------------------------------------------------- */
#define RST_0_ADDR          0x00
#define RST_1_ADDR          0x08
#define RST_2_ADDR          0x10
#define RST_3_ADDR          0x18
#define RST_4_ADDR          0x20
#define RST_5_ADDR          0x28
#define RST_6_ADDR          0x30
#define RST_7_ADDR          0x38
#define TRAP_ADDR           0x24
#define RST_5_5_ADDR        0x2C
#define RST_6_5_ADDR        0x34
#define RST_7_5_ADDR        0x3C

#define TRAP_INTR           0x00
#define RST_5_5_INTR        0x01
#define RST_6_5_INTR        0x02
#define RST_7_5_INTR        0x03

/* -----------------------------------------------------------------------
 * LED display segment bit flags
 * --------------------------------------------------------------------- */
#define LED_A               0x01
#define LED_B               0x02
#define LED_C               0x04
#define LED_D               0x08
#define LED_E               0x10
#define LED_F               0x20
#define LED_G               0x40
#define LED_DOT             0x80

/* 7-segment encodings */
#define _LED_0  63
#define _LED_1  6
#define _LED_2  91
#define _LED_3  79
#define _LED_4  102
#define _LED_5  109
#define _LED_6  125
#define _LED_7  7
#define _LED_8  127
#define _LED_9  111
#define _LED_A  119
#define _LED_B  124
#define _LED_C  57
#define _LED_D  94
#define _LED_E  121
#define _LED_F  113
#define _LED_BLANK   128
#define _LED_DOT     129
#define _LED_HYPHEN  130

/* -----------------------------------------------------------------------
 * Opcode lengths
 * --------------------------------------------------------------------- */
#define NOP_LEN     1
#define MOV_LEN     1
#define MVI_LEN     2
#define LXI_LEN     3
#define LDAX_LEN    1
#define STAX_LEN    1
#define LHLD_LEN    3
#define SHLD_LEN    3
#define LDA_LEN     3
#define STA_LEN     3
#define INR_LEN     1
#define INX_LEN     1
#define DCR_LEN     1
#define DCX_LEN     1
#define DAD_LEN     1
#define ADD_LEN     1
#define ADC_LEN     1
#define ADI_LEN     2
#define ACI_LEN     2
#define SUB_LEN     1
#define SBB_LEN     1
#define SUI_LEN     2
#define SBI_LEN     2
#define ANA_LEN     1
#define ANI_LEN     2
#define XRA_LEN     1
#define XRI_LEN     2
#define ORA_LEN     1
#define ORI_LEN     2
#define CMP_LEN     1
#define CPI_LEN     2
#define RLC_LEN     1
#define RRC_LEN     1
#define RAL_LEN     1
#define RAR_LEN     1
#define CMA_LEN     1
#define CMC_LEN     1
#define STC_LEN     1
#define DAA_LEN     1
#define JMP_LEN     3
#define CALL_LEN    3
#define RET_LEN     1
#define RST_LEN     1
#define PUSH_LEN    1
#define POP_LEN     1
#define SPHL_LEN    1
#define XTHL_LEN    1
#define XCHG_LEN    1
#define IN_LEN      2
#define OUT_LEN     2
#define EI_LEN      1
#define DI_LEN      1
#define HLT_LEN     1
#define RIM_LEN     1
#define SIM_LEN     1

/* Opcode start values */
#define MOV_START   0x40
#define MVI_START   0x06
#define LDAX_START  0x0A
#define LHLD_START  0x2A
#define LDA_START   0x3A
#define STAX_START  0x02
#define SHLD_START  0x22
#define STA_START   0x32
#define LXI_START   0x01
#define SPHL_START  0xF9
#define XTHL_START  0xE3
#define XCHG_START  0xEB
#define OUT_START   0xD3
#define IN_START    0xDB
#define PUSH_START  0xC5
#define POP_START   0xC1
#define ADD_START   0x80
#define ADC_START   0x88
#define ADI_START   0xC6
#define ACI_START   0xCE
#define SUB_START   0x90
#define SBB_START   0x98
#define SUI_START   0xD6
#define SBI_START   0xDE
#define DAD_START   0x09
#define DAA_START   0x27
#define INR_START   0x04
#define INX_START   0x03
#define DCR_START   0x05
#define DCX_START   0x0B
#define STC_START   0x37
#define ANA_START   0xA0
#define ANI_START   0xE6
#define XRA_START   0xA8
#define XRI_START   0xEE
#define ORA_START   0xB0
#define ORI_START   0xF6
#define CMP_START   0xB8
#define CPI_START   0xFE
#define RLC_START   0x07
#define RRC_START   0x0F
#define RAL_START   0x17
#define RAR_START   0x1F
#define CMA_START   0x2F
#define CMC_START   0x3F
#define HLT_START   0x76

/* -----------------------------------------------------------------------
 * Error codes (returned by parse/simulate functions)
 * --------------------------------------------------------------------- */
#define FILE_NOT_FOUND          (-1)
#define REGISTER_EXPECT         (-2)
#define REG_OR_MEM_EXPECT       (-3)
#define COMMA_EXPECTED          (-4)
#define NUMBER_EXPECT           (-5)
#define BAD_NUMBER_FORMAT       (-6)
#define LARGE_NUMBER            (-7)
#define MEM_TO_MEM_TRANSFER     (-8)
#define WRONG_REG               (-9)
#define ADDR_TOO_LARGE          (-10)
#define EXTRA_INPUT             (-11)
#define SYMBOL_TABLE_FULL       (-12)
#define SYMBOL_NOT_FOUND        (-13)
#define EXECUTE_ERROR           (-14)
#define INVALID_OPCODE          (-15)
#define READ_SEG_FAULT          (-16)
#define WRITE_SEG_FAULT         (-17)
#define STACK_OVER_ERROR        (-18)
#define STACK_UNDER_ERROR       (-19)
#define BAD_SYSTEM_CALL         (-20)
#define __BAD_NUMBER_FORMAT     (-100)

/* -----------------------------------------------------------------------
 * Function pointer types
 * --------------------------------------------------------------------- */
typedef int (*ptr_to_parse)(void);
typedef int (*ptr_to_simulate)(void);
typedef int (*ptr_to_convert)(unsigned _addr, int pos, char *s);

/* -----------------------------------------------------------------------
 * Core data structures
 * --------------------------------------------------------------------- */
typedef struct {
    uchar   a, flags;
    uchar   b, c;
    uchar   d, e;
    uchar   h, l;
    word    ip;
    word    sp;
    word    temp;
    dword   temp32;
} registers;

typedef struct {
    registers   r;
    uchar       ram[MAIN_MEMORY];
    unsigned    immediate;
    unsigned    ptr;       /* assembler write pointer */
} cpu_struct;

typedef struct {
    char     name[LABEL_LEN];
    unsigned addr;
} one_entry;

typedef struct {
    one_entry entry[TABLE_LENGTH];
    int       max;
} symbol_table;

typedef struct {
    int status_field[MAX_STATUS_FIELDS];
    int addr_field[MAX_ADDR_FIELDS];
    int data_field[MAX_DATA_FIELDS];
} led_data_struct;

typedef struct {
    long lines_assembled;
    word last_break_point;
    word break_points[MAX_BREAK_POINTS + 1];
    word bk_ctr;
} debug_info;

typedef struct {
    int  incr;
    uchar code;
    ptr_to_simulate simu;
    int  run;
    int  step_over;
    word old_ip;
    word step_over_ip;
} misc_state;

typedef struct {
    int          executing;
    volatile int interrupted;
    uchar        ei;
    uchar        rst_5_5_ff;
    uchar        rst_6_5_ff;
    uchar        rst_7_5_ff;
    uchar        pending_5_5;
    uchar        pending_6_5;
    uchar        pending_7_5;
    volatile int interrupt_number;
} interrupt_struct;

typedef struct {
    ptr_to_simulate Simulate;
    char           *name;
    ptr_to_convert  Convert;
    uchar           length;
} machine_op_struct;

typedef machine_op_struct machine_op_table[MAX_INSTRUCTIONS];

typedef struct {
    char   name[33];
    int    len;
    ptr_to_parse parse;
} instruction_struct;

typedef struct {
    char  token[TOKEN_SIZE + 2];
    char  last[TOKEN_SIZE + 2];
    int   current;
    char *str;
    int   line_number;
    char  buffer[LINE_LENGTH + 2];
} lex_struct;

/* -----------------------------------------------------------------------
 * Top-level machine structure
 * --------------------------------------------------------------------- */
typedef struct {
    cpu_struct      cpu;
    unsigned        status;
    led_data_struct led;
    debug_info      i;
    misc_state      m;
    interrupt_struct intr_info;
} machine;

typedef machine *machine_ptr;

/* -----------------------------------------------------------------------
 * Global state (defined in sim8085_core.c)
 * --------------------------------------------------------------------- */
extern machine_ptr  _8085;   /* pointer to active machine */
extern machine_ptr   m;      /* global machine instance   */
extern unsigned long data;
extern unsigned long addr;
extern long          X;
extern uchar         code;
extern unsigned      r1, r2;
extern lex_struct    state;
extern symbol_table  table;
extern machine_op_struct mot[MAX_INSTRUCTIONS];
extern instruction_struct mnemonic[];
extern int           GERROR_COUNT;

/* -----------------------------------------------------------------------
 * Accessor macros (replaces MACRO.H / LOWLEVEL.H inline usage)
 * --------------------------------------------------------------------- */
#define KIT                 _8085
#define INSTR()             (KIT->i)
#define LINES_ASSEMBLED()   (INSTR().lines_assembled)
#define BREAK_POINT(i)      (INSTR().break_points[i])
#define LAST_BREAK_POINT()  (INSTR().last_break_point)
#define BREAK_PT_CTR()      (INSTR().bk_ctr)

#define INTR()              (KIT->intr_info)
#define EXECUTING()         (INTR().executing)
#define INTERRUPTED()       (INTR().interrupted)
#define INTERRUPT_NUMBER()  (INTR().interrupt_number)

#define INCREMENT()         (KIT->m.incr)
#define PTR_TO_SIMU()       (KIT->m.simu)
#define RUN()               (KIT->m.run)
#define STEP_OVER()         (KIT->m.step_over)
#define OLD_IP()            (KIT->m.old_ip)
#define STEP_OVER_IP()      (KIT->m.step_over_ip)
#define CODE()              (KIT->m.code)

#define LEX_STRUCT          (state)
#define TOKEN()             (LEX_STRUCT.token)
#define STRING()            (LEX_STRUCT.str)
#define CURRENT()           (LEX_STRUCT.current)
#define LAST()              (LEX_STRUCT.last)
#define BUFFER()            (LEX_STRUCT.buffer)
#define LINE_NUMBER()       (LEX_STRUCT.line_number)
#define PTR()               (KIT->cpu.ptr)

#define SET_STATUS(x)       (KIT->status |= (x))
#define RESET_STATUS(x)     (KIT->status = (x))
#define CLEAR_STATUS(x)     (KIT->status &= ~(x))
#define GET_STATUS()        (KIT->status)

#define SYM_TABLE()         (table)
#define _MNEMONIC()         (mnemonic)
#define MAC_OP_TABLE        mot
#define SIMULATE(x)         MAC_OP_TABLE[x].Simulate

#define _LED                (KIT->led)
#define STATUS_FIELD(x)     (_LED.status_field[x])
#define ADDR_FIELD(x)       (_LED.addr_field[x])
#define DATA_FIELD(x)       (_LED.data_field[x])

/* Register accessors */
#define GetFlag()           (KIT->cpu.r.flags)
#define SetFlag(f)          (KIT->cpu.r.flags = (f))
#define GetIP()             (KIT->cpu.r.ip)
#define GetSP()             (KIT->cpu.r.sp)
#define GetA()              (KIT->cpu.r.a)
#define GetB()              (KIT->cpu.r.b)
#define GetC()              (KIT->cpu.r.c)
#define GetD()              (KIT->cpu.r.d)
#define GetE()              (KIT->cpu.r.e)
#define GetH()              (KIT->cpu.r.h)
#define GetL()              (KIT->cpu.r.l)
#define GetTemp()           (KIT->cpu.r.temp)
#define GetTemp32()         (KIT->cpu.r.temp32)
#define GetPsw()            ((GetA() << 8) + GetFlag())
#define GetHL()             ((word)(GetH() << 8) + GetL())
#define GetDE()             ((word)(GetD() << 8) + GetE())
#define GetBC()             ((word)(GetB() << 8) + GetC())

#define SetImmediate(x)     (KIT->cpu.immediate = (x))
#define SetSP(x)            (KIT->cpu.r.sp = (x))
#define SetA(x)             (KIT->cpu.r.a = (x))
#define SetB(x)             (KIT->cpu.r.b = (x))
#define SetC(x)             (KIT->cpu.r.c = (x))
#define SetD(x)             (KIT->cpu.r.d = (x))
#define SetE(x)             (KIT->cpu.r.e = (x))
#define SetH(x)             (KIT->cpu.r.h = (x))
#define SetL(x)             (KIT->cpu.r.l = (x))
#define SetTemp(x)          (KIT->cpu.r.temp = (x))
#define SetTemp32(x)        (KIT->cpu.r.temp32 = (x))

#define GetIPByte()         (GetIP() >= MAIN_MEMORY ? 0 : KIT->cpu.ram[GetIP()])
#define CharToNum(x)        ((x) >= '0' && (x) <= '9' ? (x) - '0' : \
                             toupper(x) >= 'A' ? toupper(x) - 'A' + 10 : (x) - 'a' + 10)
#define NumToChar(x)        ((x) >= 0 && (x) <= 9 ? (x) + '0' : (x) - 10 + 'A')
#define PLUS                1
#define MINUS               0

/* -----------------------------------------------------------------------
 * Forward declarations for core functions
 * --------------------------------------------------------------------- */
int   InitMachine(machine_ptr mp);
int   GetStringFromCode(unsigned _addr, char *s);
int   PerformSystemCall(void);
int   FindInTable(char *s);
int   IsABreakPoint(word a);
long  StoreSymbolsInTable(FILE *fp);
int   ParseLex(void);
int   Advance(int skip_white);
int   InsertMachineCode(uchar c);
int   InsertCodeAnd8Bit(uchar c, char imm);
int   InsertCodeAnd16Bit(uchar c, unsigned addr16);
int   IsInstruction(void);
int   IsRegs(char *s);
int   IsMem(char *s);
int   RegNumber(void);
int   Displacement(int r1, int r2);
long  StrToNum(void);
int   SetAndPrintError(int num);
int   BadSystemCall(void);
int   NumTo7Seg(int n);
int   DisplayAllLeds(void);
int   BlankAddressLed(void);
int   BlankDataLed(void);
int   BlankStatusLed(void);
int   BlankAllLeds(void);

void  sim_set_led_callback(void (*cb)(int, int, int));
const char *sim_get_last_error(void);
int   sim_step_one(void);
int   sim_run_steps(int max_steps);
void  InitSymbolTable(void);
uchar SetMemByte(unsigned addr16, uchar data8);
word  SetMemWord(unsigned addr16, word data16);
word  SetIP(unsigned i);
void  Set8085Flag(void);
int   ShouldSetAuxillaryFlag(int a, int b, int sign);
int   GetCarry(void);
int   SetCarry(int v);
int   GetAuxCarry(void);
int   SetAuxCarry(int v);
int   PerformInterrupt(int num);

#endif /* SIM8085_CORE_H */
