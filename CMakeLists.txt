cmake_minimum_required(VERSION 3.20)

project(Multiwfn LANGUAGES C Fortran)

if(WIN32)
  enable_language(RC)
endif()

include(CheckFortranCompilerFlag)

option(MULTIWFN_BUILD_GUI "Build the DISLIN/Motif GUI executable" OFF)
option(MULTIWFN_WITH_OPENMP "Enable OpenMP when the compiler supports it" ON)
option(MULTIWFN_WITH_FD "Enable fractional-derivative support via FLINT/ARB" OFF)
option(MULTIWFN_WINDOWS_STATIC_LINK "Prefer static runtime and math libraries for Windows redistribution" ON)
set(MULTIWFN_GUI_BACKEND "dislin" CACHE STRING "GUI backend used by the CMake build: dislin or 3dmol")
set_property(CACHE MULTIWFN_GUI_BACKEND PROPERTY STRINGS dislin 3dmol)
set(MULTIWFN_3DMOL_DEFAULT_SHELL "browser" CACHE STRING "Default shell for the 3Dmol backend: browser or qt")
set_property(CACHE MULTIWFN_3DMOL_DEFAULT_SHELL PROPERTY STRINGS browser qt)
set(MULTIWFN_GNU_OPT_LEVEL "O2" CACHE STRING "GNU Fortran optimization level for Release builds")
set(MULTIWFN_GNU_HOT_OPT_LEVEL "" CACHE STRING "Optional GNU Fortran optimization level for selected hot sources")
set(MULTIWFN_GNU_EXTRA_FLAGS "" CACHE STRING "Extra GNU Fortran compile flags, separated by spaces")

if(WIN32 AND MULTIWFN_WINDOWS_STATIC_LINK)
  set(BLA_STATIC ON CACHE BOOL "Prefer static BLAS/LAPACK libraries" FORCE)
  set(BLA_VENDOR OpenBLAS CACHE STRING "Use OpenBLAS for static Windows builds" FORCE)
  set(_multiwfn_mingw_openblas "$ENV{MINGW_PREFIX}/lib/libopenblas.a")
  if(EXISTS "${_multiwfn_mingw_openblas}")
    set(BLAS_LIBRARIES "${_multiwfn_mingw_openblas}" CACHE FILEPATH "Static OpenBLAS library" FORCE)
    set(LAPACK_LIBRARIES "${_multiwfn_mingw_openblas}" CACHE FILEPATH "Static OpenBLAS LAPACK library" FORCE)
  endif()
  set(MULTIWFN_WINDOWS_STATIC_EXTRA_LIBRARIES "")
  foreach(_multiwfn_static_lib gomp winpthread quadmath gfortran)
    set(_multiwfn_static_path "$ENV{MINGW_PREFIX}/lib/lib${_multiwfn_static_lib}.a")
    if(EXISTS "${_multiwfn_static_path}")
      list(APPEND MULTIWFN_WINDOWS_STATIC_EXTRA_LIBRARIES "${_multiwfn_static_path}")
    endif()
  endforeach()
endif()

find_package(BLAS REQUIRED)
find_package(LAPACK REQUIRED)

message(STATUS "BLAS libraries: ${BLAS_LIBRARIES}")
message(STATUS "LAPACK libraries: ${LAPACK_LIBRARIES}")

if(MULTIWFN_BUILD_GUI)
  message(FATAL_ERROR "The CMake build currently supports noGUI only; use the original Makefile for the GUI build.")
endif()

if(NOT MULTIWFN_GUI_BACKEND MATCHES "^(dislin|3dmol)$")
  message(FATAL_ERROR "MULTIWFN_GUI_BACKEND must be dislin or 3dmol")
endif()
if(NOT MULTIWFN_3DMOL_DEFAULT_SHELL MATCHES "^(browser|qt)$")
  message(FATAL_ERROR "MULTIWFN_3DMOL_DEFAULT_SHELL must be browser or qt")
endif()

set(CMAKE_Fortran_PREPROCESS ON)
set(CMAKE_Fortran_MODULE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/mod")

if(CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  if(NOT MULTIWFN_GNU_OPT_LEVEL MATCHES "^O[0-3s]$")
    message(FATAL_ERROR "MULTIWFN_GNU_OPT_LEVEL must be one of O0, O1, O2, O3, Os")
  endif()
  if(MULTIWFN_GNU_HOT_OPT_LEVEL AND NOT MULTIWFN_GNU_HOT_OPT_LEVEL MATCHES "^O[0-3s]$")
    message(FATAL_ERROR "MULTIWFN_GNU_HOT_OPT_LEVEL must be empty or one of O0, O1, O2, O3, Os")
  endif()
  foreach(flag_var CMAKE_Fortran_FLAGS_RELEASE CMAKE_Fortran_FLAGS_RELWITHDEBINFO)
    string(REGEX REPLACE "(^| )-O[0-3s]( |$)" " -${MULTIWFN_GNU_OPT_LEVEL} " ${flag_var} "${${flag_var}}")
    string(STRIP "${${flag_var}}" ${flag_var})
  endforeach()

  set(MULTIWFN_GNU_FORTRAN_FLAGS
    -ffree-line-length-none
    -std=legacy
  )
  foreach(flag -fallow-argument-mismatch -fallow-invalid-boz)
    string(MAKE_C_IDENTIFIER "MULTIWFN_SUPPORTS_${flag}" flag_var)
    check_fortran_compiler_flag("${flag}" "${flag_var}")
    if(${flag_var})
      list(APPEND MULTIWFN_GNU_FORTRAN_FLAGS "${flag}")
    endif()
  endforeach()
  if(MULTIWFN_GNU_EXTRA_FLAGS)
    separate_arguments(MULTIWFN_GNU_EXTRA_FLAGS_LIST NATIVE_COMMAND "${MULTIWFN_GNU_EXTRA_FLAGS}")
    list(APPEND MULTIWFN_GNU_FORTRAN_FLAGS ${MULTIWFN_GNU_EXTRA_FLAGS_LIST})
  endif()
  foreach(flag IN LISTS MULTIWFN_GNU_FORTRAN_FLAGS)
    add_compile_options($<$<COMPILE_LANGUAGE:Fortran>:${flag}>)
  endforeach()
elseif(CMAKE_Fortran_COMPILER_ID MATCHES "Intel")
  add_compile_options(
    $<$<COMPILE_LANGUAGE:Fortran>:-fpp>
    $<$<COMPILE_LANGUAGE:Fortran>:-fpscomp>
    $<$<COMPILE_LANGUAGE:Fortran>:-stand>
    $<$<COMPILE_LANGUAGE:Fortran>:f08>
  )
endif()

set(MULTIWFN_CORE_SOURCES
  noGUI/dislin_mod_empty.f90
  define.f90
  util.f90
  noGUI/dislin_d_empty.f90
  noGUI/mouse_rotate_empty.f90
  Bspline.f90
  sym.F
  libreta_hybrid/libreta.f90
  function.f90
  plot.f90
  sub.f90
  integral.f90
  Lebedev-Laikov.F
  DFTxclib.F
  edflib.f90
  fparser.f90
  fileIO.f90
  spectrum.f90
  DOS.f90
  Multiwfn.f90
  0123dim.f90
  LSB.f90
  population.f90
  ext/frj.f90
  orbcomp.f90
  bondorder.f90
  topology.f90
  excittrans.f90
  otherfunc.f90
  otherfunc2.f90
  otherfunc3.f90
  O1.f90
  surfana.f90
  procgriddata.f90
  AdNDP.f90
  fuzzy.f90
  CDA.f90
  basin.f90
  orbloc.f90
  visweak.f90
  EDA.f90
  CDFT.f90
  ETS_NOCV.f90
  atmraddens.f90
  NAONBO.f90
  grid.f90
  PBC.f90
  hyper_polar.f90
  deloc_aromat.f90
  cp2kmate.f90
  minpack.f90
  libreta_hybrid/blockhrr_012345.f90
  libreta_hybrid/ean.f90
  libreta_hybrid/hrr_012345.f90
  libreta_hybrid/eanvrr_012345.f90
  libreta_hybrid/boysfunc.f90
  libreta_hybrid/naiveeri.f90
  libreta_hybrid/ryspoly.f90
  ext/2F2.f90
)

set(MULTIWFN_GUI_SOURCE GUI.f90)
set(MULTIWFN_EXECUTABLE_NAME Multiwfn_noGUI)
if(MULTIWFN_GUI_BACKEND STREQUAL "3dmol")
  set(MULTIWFN_GUI_SOURCE noGUI/GUI_3dmol.f90)
  set(MULTIWFN_EXECUTABLE_NAME Multiwfn_3DmolGUI)
  if(MULTIWFN_3DMOL_DEFAULT_SHELL STREQUAL "qt")
    set(MULTIWFN_EXECUTABLE_NAME Multiwfn_QtGUI)
  endif()
  list(APPEND MULTIWFN_CORE_SOURCES noGUI/plot_external_empty.f90)
endif()
list(INSERT MULTIWFN_CORE_SOURCES 10 "${MULTIWFN_GUI_SOURCE}")

# DFTxclib.F uses fixed-form continuation lines beginning with '#'. Running it
# through cpp makes GNU Fortran report "invalid preprocessing directive".
set_source_files_properties(DFTxclib.F PROPERTIES Fortran_PREPROCESS OFF)

if(CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  set_source_files_properties(
    O1.f90
    libreta_hybrid/blockhrr_012345.f90
    PROPERTIES COMPILE_OPTIONS "$<$<CONFIG:Release>:-O1>"
  )
  if(MULTIWFN_GNU_HOT_OPT_LEVEL)
    set_source_files_properties(
      function.f90
      grid.f90
      util.f90
      libreta_hybrid/libreta.f90
      PROPERTIES COMPILE_OPTIONS "$<$<CONFIG:Release>:-${MULTIWFN_GNU_HOT_OPT_LEVEL}>"
    )
  endif()
endif()

if(MULTIWFN_WITH_FD)
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(GMP REQUIRED gmp)
  pkg_check_modules(FLINT REQUIRED flint)
  if(FLINT_VERSION VERSION_LESS "3")
    pkg_check_modules(ARB REQUIRED arb)
  endif()
  list(APPEND MULTIWFN_CORE_SOURCES ext/2F2.c)
else()
  list(APPEND MULTIWFN_CORE_SOURCES ext/no2F2.c)
endif()

add_executable(${MULTIWFN_EXECUTABLE_NAME} ${MULTIWFN_CORE_SOURCES})

if(MULTIWFN_GUI_BACKEND STREQUAL "3dmol" AND MULTIWFN_3DMOL_DEFAULT_SHELL STREQUAL "qt")
  target_compile_definitions(${MULTIWFN_EXECUTABLE_NAME} PRIVATE MULTIWFN_3DMOL_DEFAULT_SHELL_QT)
endif()

if(MULTIWFN_GUI_BACKEND STREQUAL "3dmol")
  find_package(Python3 QUIET COMPONENTS Interpreter)
  if(NOT Python3_Interpreter_FOUND)
    message(WARNING
      "The 3Dmol development shell requires Python 3 at runtime. "
      "Install Python 3 or provide an interpreter through MULTIWFN_3DMOL_PYTHON when launching."
    )
  elseif(MULTIWFN_3DMOL_DEFAULT_SHELL STREQUAL "qt")
    execute_process(
      COMMAND "${Python3_EXECUTABLE}" -c "import PyQt6; import PyQt6.QtWebEngineWidgets"
      RESULT_VARIABLE _multiwfn_qt_python_status
      OUTPUT_QUIET
      ERROR_QUIET
    )
    if(NOT _multiwfn_qt_python_status EQUAL 0)
      message(WARNING
        "The Qt development shell requires PyQt6 and PyQt6-WebEngine for its embedded 3D viewer. "
        "They were not importable with ${Python3_EXECUTABLE}; install them or configure "
        "MULTIWFN_3DMOL_DEFAULT_SHELL=browser."
      )
    endif()
  endif()

  set(MULTIWFN_3DMOL_BUILD_RESOURCES "${CMAKE_CURRENT_BINARY_DIR}/resources")
  add_custom_target(multiwfn_3dmol_resources ALL
    COMMAND ${CMAKE_COMMAND} -E rm -rf
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/tools"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/3dmol-viewer"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/qt-multiwfn-gui"
    COMMAND ${CMAKE_COMMAND} -E make_directory
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/tools"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${CMAKE_CURRENT_SOURCE_DIR}/settings.ini"
      "${CMAKE_CURRENT_BINARY_DIR}/settings.ini"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/multiwfn_3dmol_server.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/multiwfn_analysis.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/multiwfn_3dmol_file_dialog.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/multiwfn_progress.py"
      "${CMAKE_CURRENT_SOURCE_DIR}/tools/multiwfn_qt_gui.py"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/tools"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${CMAKE_CURRENT_SOURCE_DIR}/frontend/3dmol-viewer"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/3dmol-viewer"
    COMMAND ${CMAKE_COMMAND} -E copy_directory
      "${CMAKE_CURRENT_SOURCE_DIR}/frontend/qt-multiwfn-gui"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/qt-multiwfn-gui"
    COMMAND ${CMAKE_COMMAND} -E rm -rf
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/tools/__pycache__"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/3dmol-viewer/__pycache__"
      "${MULTIWFN_3DMOL_BUILD_RESOURCES}/frontend/qt-multiwfn-gui/__pycache__"
    DEPENDS ${MULTIWFN_EXECUTABLE_NAME}
    COMMENT "Staging Multiwfn settings and 3Dmol GUI runtime resources"
    VERBATIM
  )
endif()

if(WIN32)
  target_compile_definitions(${MULTIWFN_EXECUTABLE_NAME} PRIVATE MULTIWFN_WINDOWS)
  target_sources(${MULTIWFN_EXECUTABLE_NAME} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/Multiwfn.rc")
endif()
target_include_directories(${MULTIWFN_EXECUTABLE_NAME} PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}/ext")
target_link_libraries(${MULTIWFN_EXECUTABLE_NAME} PRIVATE ${BLAS_LIBRARIES} ${LAPACK_LIBRARIES})

if(WIN32 AND MULTIWFN_WINDOWS_STATIC_LINK AND CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  target_link_options(${MULTIWFN_EXECUTABLE_NAME} PRIVATE -static -static-libgcc -static-libgfortran)
  target_link_libraries(${MULTIWFN_EXECUTABLE_NAME} PRIVATE ${MULTIWFN_WINDOWS_STATIC_EXTRA_LIBRARIES})
endif()

if(MULTIWFN_WITH_FD)
  target_include_directories(${MULTIWFN_EXECUTABLE_NAME} PRIVATE ${GMP_INCLUDE_DIRS} ${FLINT_INCLUDE_DIRS} ${ARB_INCLUDE_DIRS})
  target_link_libraries(${MULTIWFN_EXECUTABLE_NAME} PRIVATE ${GMP_LINK_LIBRARIES} ${FLINT_LINK_LIBRARIES} ${ARB_LINK_LIBRARIES})
endif()

if(MULTIWFN_WITH_OPENMP)
  find_package(OpenMP)
  if(OpenMP_Fortran_FOUND)
    target_link_libraries(${MULTIWFN_EXECUTABLE_NAME} PRIVATE OpenMP::OpenMP_Fortran)
  else()
    message(WARNING "OpenMP was requested but not found; continuing without OpenMP.")
  endif()
endif()

install(TARGETS ${MULTIWFN_EXECUTABLE_NAME} RUNTIME DESTINATION bin)
install(FILES settings.ini DESTINATION etc/multiwfn)
