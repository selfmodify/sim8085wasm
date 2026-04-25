#ifndef SIM8085_API_H
#define SIM8085_API_H

/*
 * sim8085_api.h
 * -----------------------------------------------------------------------
 * Clean public API exposed to JavaScript via Emscripten.
 * All functions prefixed sim_ are exported with EMSCRIPTEN_KEEPALIVE.
 *
 * JavaScript usage (after loading sim8085.js):
 *
 *   const sim = await Sim8085.create();
 *   sim.init();
 *   const result = sim.assemble(sourceCode);
 *   if (result.ok) {
 *     sim.reset();
 *     sim.step();               // execute one instruction
 *     sim.run(10000);           // run up to N instructions
 *     const regs = sim.getRegisters();
 *     const mem  = sim.getMemory(0x100, 64);
 *   }
 * -----------------------------------------------------------------------
 */

#include "sim8085_core.h"

/* -----------------------------------------------------------------------
 * Structs returned to JS (plain C, no padding concerns at these sizes)
 * --------------------------------------------------------------------- */

typedef struct {
    uint8_t  a, b, c, d, e, h, l;
    uint8_t  flags;
    uint16_t pc;   /* instruction pointer */
    uint16_t sp;   /* stack pointer */
    /* Decoded flags */
    uint8_t  flag_s;   /* sign */
    uint8_t  flag_z;   /* zero */
    uint8_t  flag_ac;  /* auxiliary carry */
    uint8_t  flag_p;   /* parity */
    uint8_t  flag_cy;  /* carry */
    /* Machine status */
    uint16_t status;
    uint8_t  halted;
    uint8_t  has_error;
} Sim8085Registers;

typedef struct {
    int     ok;            /* 1 = success, 0 = error */
    int     error_line;    /* line number of error (0 if none) */
    char    error_msg[256];
    int     entry_point;   /* address to start execution from */
    int     bytes_emitted; /* number of bytes assembled */
} Sim8085AssembleResult;

typedef struct {
    int  field_type; /* 0=status, 1=addr, 2=data */
    int  index;
    int  value;      /* 7-segment encoded value */
} Sim8085LedUpdate;

/* -----------------------------------------------------------------------
 * API function declarations
 * --------------------------------------------------------------------- */
#ifdef __cplusplus
extern "C" {
#endif

/* Lifecycle */
void sim_init(void);
void sim_reset(void);

/* Assembly */
Sim8085AssembleResult sim_assemble(const char *source);

/* Execution */
int  sim_step(void);           /* execute one instruction; returns 1=running, 0=stopped */
int  sim_run(int max_steps);   /* run up to max_steps; returns steps executed */

/* State inspection */
Sim8085Registers sim_get_registers(void);
void sim_get_memory(uint16_t start, uint16_t length, uint8_t *out_buf);
uint8_t  sim_read_byte(uint16_t addr);
void     sim_write_byte(uint16_t addr, uint8_t val);
uint16_t sim_get_pc(void);
uint16_t sim_get_sp(void);
uint16_t sim_get_status(void);

/* Breakpoints */
int  sim_set_breakpoint(uint16_t addr);    /* returns 1=set, 2=toggled off */
void sim_clear_breakpoint(uint16_t addr);
void sim_clear_all_breakpoints(void);
int  sim_is_breakpoint(uint16_t addr);

/* LED display */
int  sim_get_led(int field_type, int index);   /* get 7-segment value */
void sim_get_all_leds(int *out_buf);           /* fills 8 ints: 2 status + 4 addr + 2 data */

/* Disassembly */
int  sim_disassemble(uint16_t addr, char *out_buf, int buf_len);

/* Error info */
const char *sim_get_error(void);
int  sim_is_halted(void);
int  sim_is_running(void);

#ifdef __cplusplus
}
#endif

#endif /* SIM8085_API_H */
