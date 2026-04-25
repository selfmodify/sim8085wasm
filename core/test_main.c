/*
 * test_main.c
 * -----------------------------------------------------------------------
 * Native test harness for sim8085_core.
 * Run this to verify the assembler and CPU before the WASM build.
 *
 * Build:  mkdir build && cd build && cmake .. && make
 * Run:    ./sim8085_test
 * -----------------------------------------------------------------------
 */

#include "sim8085_core.h"
#include "sim8085_api.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static int tests_run    = 0;
static int tests_passed = 0;
static int tests_failed = 0;

#define TEST(name) \
    do { printf("  %-40s ", name); tests_run++; } while(0)

#define PASS() \
    do { printf("PASS\n"); tests_passed++; } while(0)

#define FAIL(msg) \
    do { printf("FAIL — %s\n", msg); tests_failed++; } while(0)

#define ASSERT_EQ(a, b, msg) \
    do { if ((a) == (b)) PASS(); else { \
        printf("FAIL — %s: expected %d got %d\n", msg, (int)(b), (int)(a)); \
        tests_failed++; } } while(0)

/* -----------------------------------------------------------------------
 * Helper: assemble source, check for success
 * --------------------------------------------------------------------- */
static Sim8085AssembleResult assemble_and_check(const char *src, const char *label) {
    Sim8085AssembleResult r = sim_assemble(src);
    if (!r.ok) {
        printf("  ASSEMBLE ERROR in %s: %s\n", label, r.error_msg);
    }
    return r;
}

/* -----------------------------------------------------------------------
 * Test 1: basic register operations
 * --------------------------------------------------------------------- */
static void test_registers(void) {
    printf("\n[Register operations]\n");

    sim_init();
    Sim8085AssembleResult r = assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi a,42\n"
        "mvi b,10\n"
        "mvi c,20\n"
        "hlt\n",
        "register load"
    );
    if (!r.ok) return;

    sim_reset();
    sim_run(100);

    Sim8085Registers regs = sim_get_registers();
    TEST("MVI A,42H");   ASSERT_EQ(regs.a, 0x42, "A register");
    TEST("MVI B,10H");   ASSERT_EQ(regs.b, 0x10, "B register");
    TEST("MVI C,20H");   ASSERT_EQ(regs.c, 0x20, "C register");
    TEST("HLT sets halted"); ASSERT_EQ(regs.halted, 1, "halted flag");
}

/* -----------------------------------------------------------------------
 * Test 2: arithmetic & flags
 * --------------------------------------------------------------------- */
static void test_arithmetic(void) {
    printf("\n[Arithmetic & flags]\n");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi a,0fH\n"    /* A = 0x0F */
        "adi 01\n"        /* A = 0x10, AC should be set */
        "hlt\n",
        "ADI with aux carry"
    );
    sim_reset();
    sim_run(100);
    Sim8085Registers r = sim_get_registers();
    TEST("ADI 0F+01=10H"); ASSERT_EQ(r.a, 0x10, "result");
    TEST("Auxiliary carry"); ASSERT_EQ(r.flag_ac, 1, "AC flag");
    TEST("Carry clear");    ASSERT_EQ(r.flag_cy, 0, "CY flag");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi a,ffH\n"    /* A = 0xFF */
        "adi 01\n"        /* A = 0x00, zero + carry */
        "hlt\n",
        "ADI with carry"
    );
    sim_reset();
    sim_run(100);
    r = sim_get_registers();
    TEST("ADI FF+01=00H"); ASSERT_EQ(r.a, 0x00, "result");
    TEST("Zero flag");     ASSERT_EQ(r.flag_z, 1, "Z flag");
    TEST("Carry set");     ASSERT_EQ(r.flag_cy, 1, "CY flag");
}

/* -----------------------------------------------------------------------
 * Test 3: memory operations
 * --------------------------------------------------------------------- */
static void test_memory(void) {
    printf("\n[Memory operations]\n");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "setbyte 300,55H\n"
        "lda 300\n"       /* load from memory */
        "sta 400\n"       /* store to memory */
        "hlt\n",
        "LDA/STA"
    );
    sim_reset();
    sim_run(100);

    Sim8085Registers r = sim_get_registers();
    TEST("LDA reads 55H");    ASSERT_EQ(r.a, 0x55, "A after LDA");
    TEST("STA writes to 400"); ASSERT_EQ(sim_read_byte(0x400), 0x55, "mem[400]");
}

/* -----------------------------------------------------------------------
 * Test 4: branch & loop (bubble sort style)
 * --------------------------------------------------------------------- */
static void test_branches(void) {
    printf("\n[Branches & loops]\n");

    sim_init();
    /* Simple countdown loop: B counts from 3 down to 0 */
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi b,3\n"
        "loop: dcr b\n"
        "jnz loop\n"
        "hlt\n",
        "countdown loop"
    );
    sim_reset();
    sim_run(1000);

    Sim8085Registers r = sim_get_registers();
    TEST("B counts to 0"); ASSERT_EQ(r.b, 0x00, "B register");
    TEST("Zero flag set"); ASSERT_EQ(r.flag_z, 1, "Z flag");
}

/* -----------------------------------------------------------------------
 * Test 5: stack operations (PUSH/POP/CALL/RET)
 * --------------------------------------------------------------------- */
static void test_stack(void) {
    printf("\n[Stack & subroutines]\n");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "lxi sp,200\n"    /* set up stack */
        "mvi a,99H\n"
        "push psw\n"
        "mvi a,00\n"      /* clear A */
        "pop psw\n"       /* restore A */
        "hlt\n",
        "PUSH PSW / POP PSW"
    );
    sim_reset();
    sim_run(100);

    Sim8085Registers r = sim_get_registers();
    TEST("POP restores A=99H"); ASSERT_EQ(r.a, 0x99, "A after POP PSW");
}

/* -----------------------------------------------------------------------
 * Test 6: the original BUBBLE.85 example
 * --------------------------------------------------------------------- */
static void test_bubble_sort(void) {
    printf("\n[Bubble sort (BUBBLE.85)]\n");

    sim_init();
    Sim8085AssembleResult r = assemble_and_check(
        "setbyte 251,34\n"
        "setbyte 252,30\n"
        "setbyte 253,26\n"
        "setbyte 254,23\n"
        "setbyte 255,20\n"
        "setbyte 256,17\n"
        "setbyte 257,14\n"
        "setbyte 258,10\n"
        "setbyte 259,7\n"
        "setbyte 25a,3\n"
        "org 100\n"
        "kickoff 100\n"
        "mvi  b,9\n"
        "loop2: lxi  h,251\n"
        "mov  c,b\n"
        "loop1: mov  a,m\n"
        "inx  h\n"
        "cmp  m\n"
        "jc   next\n"
        "mov  d,m\n"
        "mov  m,a\n"
        "dcx  h\n"
        "mov  m,d\n"
        "inx  h\n"
        "next: dcr  c\n"
        "jnz  loop1\n"
        "dcr  b\n"
        "jnz  loop2\n"
        "hlt\n",
        "BUBBLE.85"
    );

    if (!r.ok) { printf("  Assembly failed: %s\n", r.error_msg); return; }

    sim_reset();
    sim_run(100000);   /* give it plenty of steps */

    /* After sorting, 0x251..0x25A should be in ascending order */
    int sorted = 1;
    int i;
    for (i = 0x251; i < 0x25A; i++) {
        if (sim_read_byte(i) > sim_read_byte(i+1)) { sorted = 0; break; }
    }
    TEST("Array sorted"); ASSERT_EQ(sorted, 1, "sorted check");

    if (sorted) {
        printf("  Values: ");
        for (i = 0x251; i <= 0x25A; i++)
            printf("%02X ", sim_read_byte(i));
        printf("\n");
    }
}

/* -----------------------------------------------------------------------
 * Test 7: breakpoints
 * --------------------------------------------------------------------- */
static void test_breakpoints(void) {
    printf("\n[Breakpoints]\n");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi a,01\n"   /* 100: 2 bytes */
        "mvi b,02\n"   /* 102: 2 bytes */
        "mvi c,03\n"   /* 104: 2 bytes */
        "hlt\n",
        "breakpoint test"
    );
    sim_reset();

    /* Set breakpoint at 0x104 (third instruction) */
    sim_set_breakpoint(0x104);
    sim_run(1000);   /* should stop at breakpoint */

    Sim8085Registers r = sim_get_registers();
    TEST("Stops at breakpoint 0x104"); ASSERT_EQ(r.pc, 0x104, "PC at breakpoint");
    TEST("A=01 (before bp)");          ASSERT_EQ(r.a, 0x01, "A register");
    TEST("B=02 (before bp)");          ASSERT_EQ(r.b, 0x02, "B register");
    TEST("C=00 (not yet executed)");   ASSERT_EQ(r.c, 0x00, "C register");
}

/* -----------------------------------------------------------------------
 * Test 8: disassembler
 * --------------------------------------------------------------------- */
static void test_disassembler(void) {
    printf("\n[Disassembler]\n");

    sim_init();
    assemble_and_check(
        "org 100\n"
        "kickoff 100\n"
        "mvi a,42H\n"
        "hlt\n",
        "disassembler"
    );

    char buf[64];
    int len = sim_disassemble(0x100, buf, sizeof(buf));
    TEST("MVI A disassembles (len=2)"); ASSERT_EQ(len, 2, "instruction length");
    TEST("Contains 'mvi'");
    if (strstr(buf, "mvi") != NULL || strstr(buf, "MVI") != NULL) PASS();
    else FAIL(buf);
}

/* -----------------------------------------------------------------------
 * main
 * --------------------------------------------------------------------- */
int main(void) {
    printf("=============================================================\n");
    printf("  sim8085 Core Test Suite\n");
    printf("=============================================================\n");

    test_registers();
    test_arithmetic();
    test_memory();
    test_branches();
    test_stack();
    test_bubble_sort();
    test_breakpoints();
    test_disassembler();

    printf("\n=============================================================\n");
    printf("  Results: %d/%d passed", tests_passed, tests_run);
    if (tests_failed > 0)
        printf("  (%d FAILED)", tests_failed);
    printf("\n=============================================================\n");

    return tests_failed > 0 ? 1 : 0;
}
