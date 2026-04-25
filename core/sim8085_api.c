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
    uint8_t mem_backup[MAIN_MEMORY];
    memcpy(mem_backup, KIT->cpu.ram, MAIN_MEMORY);
    InitMachine(m);
    memcpy(KIT->cpu.ram, mem_backup, MAIN_MEMORY);
    /* Reset LED */
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
    return KIT ? ((GET_STATUS() & (HALTED|QUIT)) ? 1 : 0) : 0;
}

EXPORT int sim_is_running(void) {
    return KIT ? (!(GET_STATUS() & (HALTED|QUIT|SEVERE_ERROR)) ? 1 : 0) : 0;
}
