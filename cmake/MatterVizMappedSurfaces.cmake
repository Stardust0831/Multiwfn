# These callers own the coloring grids as local arrays. Expose them only at
# their existing display calls; keep tracked upstream calculation sources intact.
# Fail closed if an upstream update changes either display boundary.
function(matterviz_map_display_call source before after)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/${source}")
  file(READ "${CMAKE_CURRENT_SOURCE_DIR}/${source}" contents)
  string(REPLACE "\r\n" "\n" contents "${contents}")
  string(FIND "${contents}" "${before}" match)
  if(match EQUAL -1)
    message(FATAL_ERROR "MatterViz mapped-isosurface display boundary changed in ${source}")
  endif()
  string(LENGTH "${before}" match_length)
  math(EXPR remainder_start "${match} + ${match_length}")
  string(SUBSTRING "${contents}" ${remainder_start} -1 remainder)
  string(FIND "${remainder}" "${before}" duplicate)
  if(NOT duplicate EQUAL -1)
    message(FATAL_ERROR "MatterViz mapped-isosurface display boundary is ambiguous in ${source}")
  endif()
  string(REPLACE "${before}" "${after}" contents "${contents}")
  set(generated "${CMAKE_CURRENT_BINARY_DIR}/matterviz-adapters/${source}")
  # Do not interpret upstream @...@ strings or generator expressions as CMake.
  # Preserve timestamps on unchanged output to avoid unnecessary recompilation.
  if(EXISTS "${generated}")
    file(READ "${generated}" previous)
  else()
    set(previous "")
  endif()
  if(NOT contents STREQUAL previous)
    file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/matterviz-adapters")
    file(WRITE "${generated}" "${contents}")
  endif()
  list(TRANSFORM MULTIWFN_CORE_SOURCES REPLACE "^${source}$" "${generated}")
  set(MULTIWFN_CORE_SOURCES "${MULTIWFN_CORE_SOURCES}" PARENT_SCOPE)
endfunction()

matterviz_map_display_call(otherfunc.f90
  "call drawisosurgui(1)\n\t\tcubmat=exchangedata"
  "call draw_funcvsfunc_isosurface(1,iwork,exchangedata)\n\t\tcubmat=exchangedata")
matterviz_map_display_call(visweak.f90
  "call drawisosurgui(1)\n\telse if (isel==5) then"
  "call draw_igm_isosurface(1,iIGMtype,itype,sl2r)\n\telse if (isel==5) then")
