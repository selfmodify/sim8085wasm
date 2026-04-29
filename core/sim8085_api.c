/*
 * sim8085_api.c
 * -----------------------------------------------------------------------
 * Implementation of the clean public API.
 * This is the only file that touches Emscripten-specific headers.
 * When building natively (for testing), EMSCRIPTEN_KEEPALIVE is a no-op.
 * -----------------------------------------------------------------------
 */

#include "sim8085_core.h"
#include "sim8085_api.h"
#include <string.h>
#include <stdio.h>

#ifdef __EMSCRIPTEN__
#  include <emscripten.h>
#  define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#  define EXPORT
#endif

/* -----------------------------------------------------------------------
 * LED state storage (updated by the core via callback)
 * --------------------------------------------------------------------- */
static int g_leds[8]; /* [0,1]=status, [2,3,4,5]=addr, [6,7]=data */

static void led_callback(int field_type, int index, int value) {
    if (field_type == 0 && index < 2)   g_leds[index]     = value;
    if (field_type == 1 && index < 4)   g_leds[2 + index] = value;
    if (field_type == 2 && index < 2)   g_leds[6 + index] = value;
}

/* -----------------------------------------------------------------------
 * Lifecycle
 * --------------------------------------------------------------------- */

EXPORT void sim_init(void) {
    if (!m) {
        m = (machine_ptr)malloc(sizeof(machine));
        if (!m) return;
    }
    _8085 = m;
    InitMachine(m);
    sim_set_led_callback(led_callback);
    memset(g_leds, 0, sizeof(g_leds));
}

EXPORT void sim_reset(void) {
    if (!KIT) { sim_init(); return; }
    /* Preserve memory but reset CPU state */
    uint8_t *mem_backup = (uint8_t *)malloc(MAIN_MEMORY);
    if (mem_backup) {
        memcpy(mem_backup, KIT->cpu.ram, MAIN_MEMORY);
        InitMachine(m);
        memcpy(KIT->cpu.ram, mem_backup, MAIN_MEMORY);
        free(mem_backup);
    } else {
        InitMachine(m);
    }
    memset(g_leds, 0, sizeof(g_leds));
}

/* -----------------------------------------------------------------------
 * Assembly
 * --------------------------------------------------------------------- */

EXPORT Sim8085AssembleResult sim_assemble(const char *source) {
    Sim8085AssembleResult result;
    memset(&result, 0, sizeof(result));

    if (!KIT) sim_init();

    /* Write source to a temporary in-memory FILE */
    FILE *fp = tmpfile();
    if (!fp) {
        result.ok = 0;
        strncpy(result.error_msg, "Could not create temp file", 255);
        return result;
    }
    fputs(source, fp);
    rewind(fp);

    /* Reset machine memory and CPU before assembling */
    InitMachine(m);

    /* Pass 1 */
    LINE_NUMBER() = 0;
    long count = StoreSymbolsInTable(fp);
    if (count < 0) {
        result.ok = 0;
        strncpy(result.error_msg, sim_get_last_error(), 255);
        result.error_line = LINE_NUMBER();
        fclose(fp);
        return result;
    }

    /* Reset for pass 2 */
    SetIP(DEFAULT_IP);
    PTR() = DEFAULT_KICKOFF;
    LINE_NUMBER() = 0;
    rewind(fp);

    char buf[LINE_LENGTH + 2];
    RESET_STATUS(0);

    while (fgets(buf, sizeof(buf), fp)) {
        LINE_NUMBER()++;
        STRING() = buf;

        if (GET_STATUS() & SEVERE_ERROR) break;

        int x = ParseLex();
        if (x < 0) {
            if (!SetAndPrintError(x)) break;
            /* Skip to end of line */
            while (CURRENT() != EOLN && CURRENT() != EOI) Advance(0);
        }
    }

    fclose(fp);

    if (GET_STATUS() & SEVERE_ERROR) {
        result.ok = 0;
        strncpy(result.error_msg, sim_get_last_error(), 255);
        result.error_line = LINE_NUMBER();
    } else {
        result.ok = 1;
        result.entry_point  = GetIP();
        result.bytes_emitted = (int)(PTR() - DEFAULT_KICKOFF);
        result.error_line   = 0;
    }

    return result;
}

/* -----------------------------------------------------------------------
 * Execution
 * --------------------------------------------------------------------- */

EXPORT int sim_step(void) {
    if (!KIT) return 0;
    return sim_step_one();
}

EXPORT int sim_run(int max_steps) {
    if (!KIT) return 0;
    return sim_run_steps(max_steps);
}

/* -----------------------------------------------------------------------
 * State inspection
 * --------------------------------------------------------------------- */

EXPORT Sim8085Registers sim_get_registers(void) {
    Sim8085Registers r;
    memset(&r, 0, sizeof(r));
    if (!KIT) return r;

    r.a     = GetA();
    r.b     = GetB();
    r.c     = GetC();
    r.d     = GetD();
    r.e     = GetE();
    r.h     = GetH();
    r.l     = GetL();
    r.flags = GetFlag();
    r.pc    = GetIP();
    r.sp    = GetSP();

    /* Decoded flags */
    r.flag_s  = (r.flags & 0x80) ? 1 : 0;
    r.flag_z  = (r.flags & 0x40) ? 1 : 0;
    r.flag_ac = (r.flags & 0x10) ? 1 : 0;
    r.flag_p  = (r.flags & 0x04) ? 1 : 0;
    r.flag_cy = (r.flags & 0x01) ? 1 : 0;

    r.status    = (uint16_t)GET_STATUS();
    r.halted    = (GET_STATUS() & (HALTED|QUIT)) ? 1 : 0;
    r.has_error = (GET_STATUS() & SEVERE_ERROR)  ? 1 : 0;
    return r;
}

EXPORT void sim_get_memory(uint16_t start, uint16_t length, uint8_t *out_buf) {
    if (!KIT || !out_buf) return;
    uint16_t i;
    for (i = 0; i < length && (start + i) < MAIN_MEMORY; i++)
        out_buf[i] = KIT->cpu.ram[start + i];
}

EXPORT uint8_t sim_read_byte(uint16_t addr) {
    if (!KIT || addr >= MAIN_MEMORY) return 0;
    return KIT->cpu.ram[addr];
}

EXPORT void sim_write_byte(uint16_t addr, uint8_t val) {
    if (!KIT || addr >= MAIN_MEMORY) return;
    KIT->cpu.ram[addr] = val;
}

EXPORT uint16_t sim_get_pc(void)     { return KIT ? GetIP()        : 0; }
EXPORT uint16_t sim_get_sp(void)     { return KIT ? GetSP()        : 0; }
EXPORT uint16_t sim_get_status(void) { return KIT ? GET_STATUS()   : 0; }

/* -----------------------------------------------------------------------
 * Breakpoints
 * --------------------------------------------------------------------- */

EXPORT int sim_set_breakpoint(uint16_t addr) {
    if (!KIT) return 0;
    int x = IsABreakPoint(addr);
    if (x >= 0) {
        /* Toggle off */
        int i;
        for (i = x; i < (int)BREAK_PT_CTR()-1; i++)
            BREAK_POINT(i) = BREAK_POINT(i+1);
        --BREAK_PT_CTR();
        return 2;
    }
    if (BREAK_PT_CTR() >= MAX_BREAK_POINTS) return 0;
    BREAK_POINT(BREAK_PT_CTR()++) = addr;
    return 1;
}

EXPORT void sim_clear_breakpoint(uint16_t addr) {
    if (!KIT) return;
    int x = IsABreakPoint(addr);
    if (x < 0) return;
    int i;
    for (i = x; i < (int)BREAK_PT_CTR()-1; i++)
        BREAK_POINT(i) = BREAK_POINT(i+1);
    --BREAK_PT_CTR();
}

EXPORT void sim_clear_all_breakpoints(void) {
    if (!KIT) return;
    BREAK_PT_CTR() = 0;
}

EXPORT int sim_is_breakpoint(uint16_t addr) {
    return KIT ? (IsABreakPoint(addr) >= 0 ? 1 : 0) : 0;
}

/* -----------------------------------------------------------------------
 * LED display
 * --------------------------------------------------------------------- */

EXPORT int sim_get_led(int field_type, int index) {
    if (field_type == 0 && index < 2) return g_leds[index];
    if (field_type == 1 && index < 4) return g_leds[2 + index];
    if (field_type == 2 && index < 2) return g_leds[6 + index];
    return 0;
}

EXPORT void sim_get_all_leds(int *out_buf) {
    if (!out_buf) return;
    memcpy(out_buf, g_leds, sizeof(g_leds));
}

/* -----------------------------------------------------------------------
 * Disassembly
 * --------------------------------------------------------------------- */

EXPORT int sim_disassemble(uint16_t addr, char *out_buf, int buf_len) {
    if (!KIT || !out_buf || buf_len < 32) return 0;
    char tmp[128];
    int len = GetStringFromCode(addr, tmp);
    strncpy(out_buf, tmp, buf_len - 1);
    out_buf[buf_len - 1] = '\0';
    return len;
}

/* -----------------------------------------------------------------------
 * Error / status
 * --------------------------------------------------------------------- */

EXPORT const char *sim_get_error(void) { return sim_get_last_error(); }

EXPORT int sim_is_halted(void) {
    if (!KIT) return 0;
    unsigned s = GET_STATUS();
    return ((s & QUIT) || ((s & HALTED) && !(s & (QUIT)))) ? 1 : 0;
}

EXPORT int sim_is_running(void) {
    return KIT ? (!(GET_STATUS() & (HALTED|QUIT|SEVERE_ERROR)) ? 1 : 0) : 0;
}

EXPORT int sim_is_halt_waiting(void) {
    if (!KIT) return 0;
    unsigned s = GET_STATUS();
    return ((s & HALTED) && !(s & (QUIT | SEVERE_ERROR))) ? 1 : 0;
}

/* -----------------------------------------------------------------------
 * Interrupt control
 * --------------------------------------------------------------------- */

EXPORT void sim_assert_interrupt(int type) {
    if (!KIT) return;
    interrupt_struct *is = &INTR();
    switch (type) {
        case 0: is->trap_pend  = 1; break;
        case 1: is->rst_7_5_ff = 1; break;
        case 2: is->rst_6_5_ff = 1; break;
        case 3: is->rst_5_5_ff = 1; break;
    }
}

EXPORT void sim_deassert_interrupt(int type) {
    if (!KIT) return;
    interrupt_struct *is = &INTR();
    switch (type) {
        case 0: is->trap_pend  = 0; break;
        case 1: is->rst_7_5_ff = 0; break;
        case 2: is->rst_6_5_ff = 0; break;
        case 3: is->rst_5_5_ff = 0; break;
    }
}

EXPORT void sim_get_int_state(Sim8085IntState *out) {
    if (!out) return;
    memset(out, 0, sizeof(*out));
    if (!KIT) return;
    interrupt_struct *is = &INTR();
    out->iff      = is->ei;
    out->int_mask = is->int_mask;
    out->rst75ff  = is->rst_7_5_ff;
    out->trap_pend= is->trap_pend;
    out->rst65    = is->rst_6_5_ff;
    out->rst55    = is->rst_5_5_ff;
    out->intr     = 0;
}

/* -----------------------------------------------------------------------
 * Keyboard queue
 * --------------------------------------------------------------------- */

EXPORT void sim_enqueue_keys(const char *s) {
    if (!KIT || !s) return;
    kbd_queue_struct *kb = &KIT->kbd;
    while (*s && kb->len < KBD_QUEUE_MAX) {
        kb->buf[kb->tail] = (uint8_t)*s++;
        kb->tail = (kb->tail + 1) % KBD_QUEUE_MAX;
        kb->len++;
    }
}

EXPORT void sim_clear_key_queue(void) {
    if (!KIT) return;
    KIT->kbd.head = KIT->kbd.tail = KIT->kbd.len = 0;
}

EXPORT int sim_get_key_queue(char *buf, int max_len) {
    if (!KIT || !buf || max_len <= 0) return 0;
    kbd_queue_struct *kb = &KIT->kbd;
    int n = kb->len < max_len ? kb->len : max_len;
    int i;
    for (i = 0; i < n; i++)
        buf[i] = (char)kb->buf[(kb->head + i) % KBD_QUEUE_MAX];
    return n;
}

/* -----------------------------------------------------------------------
 * Memory size
 * --------------------------------------------------------------------- */

static int g_memory_size = MAIN_MEMORY;

EXPORT void sim_set_memory_size(int bytes) {
    if (bytes == 16*1024 || bytes == 32*1024 || bytes == 64*1024)
        g_memory_size = bytes;
}

EXPORT int sim_get_memory_size(void) { return g_memory_size; }

/* -----------------------------------------------------------------------
 * Snapshot / step-back
 * --------------------------------------------------------------------- */

EXPORT void sim_get_full_memory(uint8_t *out_buf) {
    if (!KIT || !out_buf) return;
    memcpy(out_buf, KIT->cpu.ram, MAIN_MEMORY);
}

EXPORT void sim_restore_snapshot(const uint8_t *regs_buf, int regs_len,
                                 const uint8_t *ram_buf,  int ram_len) {
    if (!KIT) return;
    if (ram_buf && ram_len > 0) {
        int n = ram_len < MAIN_MEMORY ? ram_len : MAIN_MEMORY;
        memcpy(KIT->cpu.ram, ram_buf, n);
    }
    if (regs_buf && regs_len >= (int)sizeof(Sim8085Registers)) {
        const Sim8085Registers *r = (const Sim8085Registers *)regs_buf;
        SetA(r->a); KIT->cpu.r.b = r->b; KIT->cpu.r.c = r->c;
        KIT->cpu.r.d = r->d; KIT->cpu.r.e = r->e;
        KIT->cpu.r.h = r->h; KIT->cpu.r.l = r->l;
        SetFlag(r->flags);
        KIT->cpu.r.ip = r->pc;
        SetSP(r->sp);
    }
    KIT->status = 0;
}

/* -----------------------------------------------------------------------
 * I/O ports
 * --------------------------------------------------------------------- */

EXPORT int sim_get_output_port(uint8_t port) {
    return KIT ? KIT->cpu.output_ports[port] : 0;
}

EXPORT void sim_set_input_port(uint8_t port, uint8_t val) {
    if (KIT) KIT->cpu.input_ports[port] = val;
}

EXPORT void sim_clear_input_port(uint8_t port) {
    if (KIT) KIT->cpu.input_ports[port] = 0;
}

/* -----------------------------------------------------------------------
 * WASM glue — flat-primitive wrappers around struct-returning functions.
 * Emscripten's struct-by-value ABI uses a hidden sret pointer that makes
 * ccall/cwrap impractical.  Instead, callers invoke wasm_snap_*() to
 * populate static result buffers, then read individual scalar accessors.
 * --------------------------------------------------------------------- */
#ifdef __EMSCRIPTEN__

static Sim8085AssembleResult g_wasm_asm;
static Sim8085Registers      g_wasm_regs;
static Sim8085IntState       g_wasm_ints;
static int                   g_wasm_leds[8];
static char                  g_wasm_disasm[128];
static int                   g_wasm_disasm_len;

/* Assembly */
EXPORT int         wasm_assemble(const char *src) { g_wasm_asm = sim_assemble(src); return g_wasm_asm.ok; }
EXPORT int         wasm_asm_error_line(void)       { return g_wasm_asm.error_line; }
EXPORT const char *wasm_asm_error_msg(void)        { return g_wasm_asm.error_msg; }
EXPORT int         wasm_asm_entry_point(void)      { return g_wasm_asm.entry_point; }
EXPORT int         wasm_asm_bytes_emitted(void)    { return g_wasm_asm.bytes_emitted; }

/* Registers — snap then read individually */
EXPORT void     wasm_snap_regs(void)    { g_wasm_regs = sim_get_registers(); }
EXPORT uint8_t  wasm_reg_a(void)        { return g_wasm_regs.a; }
EXPORT uint8_t  wasm_reg_b(void)        { return g_wasm_regs.b; }
EXPORT uint8_t  wasm_reg_c(void)        { return g_wasm_regs.c; }
EXPORT uint8_t  wasm_reg_d(void)        { return g_wasm_regs.d; }
EXPORT uint8_t  wasm_reg_e(void)        { return g_wasm_regs.e; }
EXPORT uint8_t  wasm_reg_h(void)        { return g_wasm_regs.h; }
EXPORT uint8_t  wasm_reg_l(void)        { return g_wasm_regs.l; }
EXPORT uint8_t  wasm_reg_flags(void)    { return g_wasm_regs.flags; }
EXPORT uint16_t wasm_reg_pc(void)       { return g_wasm_regs.pc; }
EXPORT uint16_t wasm_reg_sp(void)       { return g_wasm_regs.sp; }
EXPORT uint8_t  wasm_reg_flag_s(void)   { return g_wasm_regs.flag_s; }
EXPORT uint8_t  wasm_reg_flag_z(void)   { return g_wasm_regs.flag_z; }
EXPORT uint8_t  wasm_reg_flag_ac(void)  { return g_wasm_regs.flag_ac; }
EXPORT uint8_t  wasm_reg_flag_p(void)   { return g_wasm_regs.flag_p; }
EXPORT uint8_t  wasm_reg_flag_cy(void)  { return g_wasm_regs.flag_cy; }
EXPORT uint16_t wasm_reg_status(void)   { return g_wasm_regs.status; }
EXPORT uint8_t  wasm_reg_halted(void)   { return g_wasm_regs.halted; }
EXPORT uint8_t  wasm_reg_has_error(void){ return g_wasm_regs.has_error; }

/* Restore registers individually (avoids struct alignment issues in JS) */
EXPORT void wasm_restore_regs(int a, int b, int c, int d, int e,
                               int h, int l, int flags, int pc, int sp) {
    if (!KIT) return;
    SetA((uint8_t)a);
    KIT->cpu.r.b = (uint8_t)b; KIT->cpu.r.c = (uint8_t)c;
    KIT->cpu.r.d = (uint8_t)d; KIT->cpu.r.e = (uint8_t)e;
    KIT->cpu.r.h = (uint8_t)h; KIT->cpu.r.l = (uint8_t)l;
    SetFlag((uint8_t)flags);
    KIT->cpu.r.ip = (uint16_t)pc;
    SetSP((uint16_t)sp);
    KIT->status = 0;
}

/* LEDs */
EXPORT void wasm_snap_leds(void) { memcpy(g_wasm_leds, g_leds, sizeof(g_leds)); }
EXPORT int  wasm_led(int i)      { return (i >= 0 && i < 8) ? g_wasm_leds[i] : 0; }

/* Interrupt state */
EXPORT void wasm_snap_ints(void)     { sim_get_int_state(&g_wasm_ints); }
EXPORT int  wasm_int_iff(void)       { return g_wasm_ints.iff; }
EXPORT int  wasm_int_mask(void)      { return g_wasm_ints.int_mask; }
EXPORT int  wasm_int_rst75ff(void)   { return g_wasm_ints.rst75ff; }
EXPORT int  wasm_int_trap_pend(void) { return g_wasm_ints.trap_pend; }
EXPORT int  wasm_int_rst65(void)     { return g_wasm_ints.rst65; }
EXPORT int  wasm_int_rst55(void)     { return g_wasm_ints.rst55; }

/* Disassembly */
EXPORT void        wasm_disassemble(int addr) {
    g_wasm_disasm_len = sim_disassemble((uint16_t)addr, g_wasm_disasm, 128);
}
EXPORT const char *wasm_disasm_text(void) { return g_wasm_disasm; }
EXPORT int         wasm_disasm_len(void)  { return g_wasm_disasm_len; }

/* Bulk port access */
EXPORT void wasm_get_all_output_ports(uint8_t *buf) {
    if (!KIT || !buf) return;
    memcpy(buf, KIT->cpu.output_ports, 256);
}
EXPORT void wasm_get_all_input_ports(uint8_t *buf) {
    if (!KIT || !buf) return;
    memcpy(buf, KIT->cpu.input_ports, 256);
}

#endif /* __EMSCRIPTEN__ */
