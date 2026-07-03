cmake_minimum_required(VERSION 3.22)

project(Multiwfn LANGUAGES C Fortran)

option(MULTIWFN_BUILD_GUI "Build the DISLIN/Motif GUI executable" OFF)
option(MULTIWFN_WITH_OPENMP "Enable OpenMP when the compiler supports it" ON)
option(MULTIWFN_WITH_FD "Enable fractional-derivative support via FLINT/ARB" OFF)
option(MULTIWFN_WINDOWS_STATIC_LINK "Prefer static runtime and math libraries for Windows redistribution" ON)

if(WIN32 AND MULTIWFN_WINDOWS_STATIC_LINK)
  set(BLA_STATIC ON CACHE BOOL "Prefer static BLAS/LAPACK libraries" FORCE)
  set(BLA_VENDOR OpenBLAS CACHE STRING "Use OpenBLAS for static Windows builds" FORCE)
  if(MULTIWFN_WITH_OPENMP)
    message(STATUS "Disabling OpenMP for the static Windows redistribution build")
    set(MULTIWFN_WITH_OPENMP OFF)
  endif()
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

set(CMAKE_Fortran_PREPROCESS ON)
set(CMAKE_Fortran_MODULE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/mod")

if(CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  foreach(flag_var CMAKE_Fortran_FLAGS_RELEASE CMAKE_Fortran_FLAGS_RELWITHDEBINFO)
    string(REPLACE "-O3" "-O2" ${flag_var} "${${flag_var}}")
  endforeach()

  add_compile_options(
    $<$<COMPILE_LANGUAGE:Fortran>:-ffree-line-length-none>
    $<$<COMPILE_LANGUAGE:Fortran>:-fallow-argument-mismatch>
    $<$<COMPILE_LANGUAGE:Fortran>:-fallow-invalid-boz>
    $<$<COMPILE_LANGUAGE:Fortran>:-std=legacy>
  )
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
  GUI.f90
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

# DFTxclib.F uses fixed-form continuation lines beginning with '#'. Running it
# through cpp makes GNU Fortran report "invalid preprocessing directive".
set_source_files_properties(DFTxclib.F PROPERTIES Fortran_PREPROCESS OFF)

if(CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  set_source_files_properties(
    O1.f90
    libreta_hybrid/blockhrr_012345.f90
    PROPERTIES COMPILE_OPTIONS "$<$<CONFIG:Release>:-O1>"
  )
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

add_executable(Multiwfn_noGUI ${MULTIWFN_CORE_SOURCES})
target_include_directories(Multiwfn_noGUI PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}" "${CMAKE_CURRENT_SOURCE_DIR}/ext")
target_link_libraries(Multiwfn_noGUI PRIVATE ${BLAS_LIBRARIES} ${LAPACK_LIBRARIES})

if(WIN32 AND MULTIWFN_WINDOWS_STATIC_LINK AND CMAKE_Fortran_COMPILER_ID STREQUAL "GNU")
  target_link_options(Multiwfn_noGUI PRIVATE -static -static-libgcc -static-libgfortran)
  target_link_libraries(Multiwfn_noGUI PRIVATE ${MULTIWFN_WINDOWS_STATIC_EXTRA_LIBRARIES})
endif()

if(MULTIWFN_WITH_FD)
  target_include_directories(Multiwfn_noGUI PRIVATE ${GMP_INCLUDE_DIRS} ${FLINT_INCLUDE_DIRS} ${ARB_INCLUDE_DIRS})
  target_link_libraries(Multiwfn_noGUI PRIVATE ${GMP_LINK_LIBRARIES} ${FLINT_LINK_LIBRARIES} ${ARB_LINK_LIBRARIES})
endif()

if(MULTIWFN_WITH_OPENMP)
  find_package(OpenMP)
  if(OpenMP_Fortran_FOUND)
    target_link_libraries(Multiwfn_noGUI PRIVATE OpenMP::OpenMP_Fortran)
  else()
    message(WARNING "OpenMP was requested but not found; continuing without OpenMP.")
  endif()
endif()

install(TARGETS Multiwfn_noGUI RUNTIME DESTINATION bin)
install(FILES settings.ini DESTINATION etc/multiwfn)
