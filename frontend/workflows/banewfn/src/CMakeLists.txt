set(BANEWFN_SRC_ROOT "${CMAKE_CURRENT_SOURCE_DIR}")

set(BANEWFN_COMMON_SOURCES
    common/citation.cpp
    common/config.cpp
    common/gui.cpp
    common/documentation.cpp
    common/plan.cpp
    common/execution_trace.cpp
    common/grep_dsl.cpp
    common/inline_conf.cpp
    common/input.cpp
    common/ui.cpp
    common/utils.cpp
)

set(BANEWFN_COMMON_HEADERS
    common/citation.h
    common/config.h
    common/grep_dsl.h
    common/inline_conf.h
    common/input.h
    common/ui.h
    common/utils.h
)

add_library(banewfn_common STATIC
    ${BANEWFN_COMMON_SOURCES}
    ${BANEWFN_COMMON_HEADERS}
)
target_include_directories(banewfn_common PUBLIC "${BANEWFN_SRC_ROOT}")
target_compile_definitions(banewfn_common PUBLIC BANEWFN_VERSION="${BANEWFN_VERSION}")

if(BANEWFN_FILESYSTEM_LIB)
    target_link_libraries(banewfn_common PUBLIC ${BANEWFN_FILESYSTEM_LIB})
endif()

if(NOT CMAKE_SYSTEM_NAME STREQUAL "Windows")
    target_compile_definitions(banewfn_common PRIVATE
        BANEWFN_SYSTEM_RC_PATH="${CMAKE_INSTALL_FULL_SYSCONFDIR}/banewfn/banewfn.rc"
        BANEWFN_SYSTEM_SHARE_RC_PATH="${CMAKE_INSTALL_FULL_DATADIR}/banewfn/conf/banewfn.rc"
    )
endif()

add_library(banewfn_core STATIC
    banewfn/application.cpp
    banewfn/application.h
    banewfn/grep_engine.cpp
    banewfn/grep_engine.h
    banewfn/promolecule.cpp
    banewfn/promolecule.h
)
target_link_libraries(banewfn_core PUBLIC banewfn_common)

add_library(bwpack_core STATIC
    bwpack/application.cpp
    bwpack/application.h
    bwpack/bwpack_support.cpp
    bwpack/bwpack_support.h
)
target_link_libraries(bwpack_core PUBLIC banewfn_common)
