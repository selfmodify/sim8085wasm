cmake_minimum_required(VERSION 3.16)
project(sim8085 C)

set(CMAKE_C_STANDARD 99)

# -------------------------------------------------------------------------
# Core source files (no platform dependencies)
# -------------------------------------------------------------------------
set(CORE_SOURCES
    core/sim8085_core.c
    core/sim8085_api.c
)

set(CORE_HEADERS
    core/sim8085_core.h
    core/sim8085_api.h
)

# -------------------------------------------------------------------------
# Emscripten / WebAssembly build
# -------------------------------------------------------------------------
if(EMSCRIPTEN)
    message(STATUS "Building for WebAssembly with Emscripten")

    add_executable(sim8085 ${CORE_SOURCES})
    target_include_directories(sim8085 PRIVATE core)

    # Exported functions — everything prefixed with sim_ in sim8085_api.h
    set(EXPORTED_FUNCS
        "_sim_init"
        "_sim_reset"
        "_sim_assemble"
        "_sim_step"
        "_sim_run"
        "_sim_get_registers"
        "_sim_get_memory"
        "_sim_read_byte"
        "_sim_write_byte"
        "_sim_get_pc"
        "_sim_get_sp"
        "_sim_get_status"
        "_sim_set_breakpoint"
        "_sim_clear_breakpoint"
        "_sim_clear_all_breakpoints"
        "_sim_is_breakpoint"
        "_sim_get_led"
        "_sim_get_all_leds"
        "_sim_disassemble"
        "_sim_get_error"
        "_sim_is_halted"
        "_sim_is_running"
        "_sim_is_halt_waiting"
        "_sim_assert_interrupt"
        "_sim_deassert_interrupt"
        "_sim_get_int_state"
        "_sim_enqueue_keys"
        "_sim_clear_key_queue"
        "_sim_get_key_queue"
        "_sim_set_memory_size"
        "_sim_get_memory_size"
        "_sim_get_full_memory"
        "_sim_restore_snapshot"
        "_sim_get_output_port"
        "_sim_set_input_port"
        "_sim_clear_input_port"
        # WASM glue — flat-primitive wrappers for struct-returning functions
        "_wasm_assemble"
        "_wasm_asm_error_line"
        "_wasm_asm_error_msg"
        "_wasm_asm_entry_point"
        "_wasm_asm_bytes_emitted"
        "_wasm_snap_regs"
        "_wasm_reg_a"
        "_wasm_reg_b"
        "_wasm_reg_c"
        "_wasm_reg_d"
        "_wasm_reg_e"
        "_wasm_reg_h"
        "_wasm_reg_l"
        "_wasm_reg_flags"
        "_wasm_reg_pc"
        "_wasm_reg_sp"
        "_wasm_reg_flag_s"
        "_wasm_reg_flag_z"
        "_wasm_reg_flag_ac"
        "_wasm_reg_flag_p"
        "_wasm_reg_flag_cy"
        "_wasm_reg_status"
        "_wasm_reg_halted"
        "_wasm_reg_has_error"
        "_wasm_restore_regs"
        "_wasm_snap_leds"
        "_wasm_led"
        "_wasm_snap_ints"
        "_wasm_int_iff"
        "_wasm_int_mask"
        "_wasm_int_rst75ff"
        "_wasm_int_trap_pend"
        "_wasm_int_rst65"
        "_wasm_int_rst55"
        "_wasm_disassemble"
        "_wasm_disasm_text"
        "_wasm_disasm_len"
        "_wasm_get_all_output_ports"
        "_wasm_get_all_input_ports"
        "_malloc"
        "_free"
    )

    # Convert list to JSON array string for emcc
    string(JOIN "," EXPORTED_FUNCS_STR ${EXPORTED_FUNCS})

    target_compile_options(sim8085 PRIVATE
        -O2
        -Wall
        -Wno-unused-function
    )

    target_link_options(sim8085 PRIVATE
        # Output both .wasm and .js glue
        "SHELL:-s WASM=1"
        # Export the listed C functions
        "SHELL:-s EXPORTED_FUNCTIONS=[${EXPORTED_FUNCS_STR}]"
        # Also export the Emscripten runtime helpers JS needs
        "SHELL:-s EXPORTED_RUNTIME_METHODS=[ccall,cwrap,getValue,setValue,stringToUTF8,UTF8ToString,HEAPU8,HEAP32,stackAlloc,stackSave,stackRestore]"
        # Allow dynamic memory growth (assembler uses malloc for tmpfile)
        "SHELL:-s ALLOW_MEMORY_GROWTH=1"
        # 4MB initial heap — more than enough for the 16KB machine + assembler
        "SHELL:-s INITIAL_MEMORY=4194304"
        # Produce a clean ES module + a UMD fallback
        "SHELL:-s MODULARIZE=1"
        "SHELL:-s EXPORT_NAME=Sim8085Module"
        # Embed the .wasm file directly into the .js for single-file deploy
        "SHELL:-s SINGLE_FILE=1"
        # Use tmpfile() — needs NODEFS or MEMFS; use MEMFS (in-browser)
        "SHELL:-s FORCE_FILESYSTEM=1"
        "SHELL:-lnodefs.js"
        # Aggressive dead-code elimination
        "SHELL:-s DEAD_FUNCTIONS=[]"
        -O2
    )

    # Output into web/public
    set_target_properties(sim8085 PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_SOURCE_DIR}/web/public"
    )

# -------------------------------------------------------------------------
# Native build (for testing without a browser)
# -------------------------------------------------------------------------
else()
    message(STATUS "Building native test binary")

    add_executable(sim8085_test
        ${CORE_SOURCES}
        core/test_main.c
    )
    target_include_directories(sim8085_test PRIVATE core)
    target_compile_options(sim8085_test PRIVATE
        -Wall -Wextra -Wno-unused-function -g
    )
endif()
