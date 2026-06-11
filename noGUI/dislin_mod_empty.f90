module dislin
implicit none

integer, parameter :: SYMBOL_EMPTY                =    -1
integer, parameter :: SYMBOL_SQUARE               =     0
integer, parameter :: SYMBOL_OCTAGON              =     1
integer, parameter :: SYMBOL_TRIANGLE_UP          =     2
integer, parameter :: SYMBOL_PLUS                 =     3
integer, parameter :: SYMBOL_CROSS                =     4
integer, parameter :: SYMBOL_DIAMOND              =     5
integer, parameter :: SYMBOL_TRIANGLE_DOWN        =     6
integer, parameter :: SYMBOL_SQUARECROSS          =     7
integer, parameter :: SYMBOL_STAR                 =     8
integer, parameter :: SYMBOL_DIAMONDPLUS          =     9
integer, parameter :: SYMBOL_OCTAGONPLUS          =    10
integer, parameter :: SYMBOL_DOUBLETRIANGLE       =    11
integer, parameter :: SYMBOL_SQUAREPLUS           =    12
integer, parameter :: SYMBOL_OCTAGONCROSS         =    13
integer, parameter :: SYMBOL_SQUARETRIANGLE       =    14
integer, parameter :: SYMBOL_CIRCLE               =    15
integer, parameter :: SYMBOL_SQUARE_FILLED        =    16
integer, parameter :: SYMBOL_OCTAGON_FILLED       =    17
integer, parameter :: SYMBOL_TRIANGLE_UP_FILLED   =    18
integer, parameter :: SYMBOL_DIAMOND_FILLED       =    19
integer, parameter :: SYMBOL_TRIANGLE_DOWN_FILLED =    20
integer, parameter :: SYMBOL_CIRCLE_FILLED        =    21
integer, parameter :: SYMBOL_DOT                  =    21
integer, parameter :: SYMBOL_HALFCIRCLE           =    22
integer, parameter :: SYMBOL_HALFCIRCLE_FILLED    =    23

integer, parameter :: LINE_NONE   =   -1
integer, parameter :: LINE_SOLID  =    0
integer, parameter :: LINE_DOT    =    1
integer, parameter :: LINE_DASH   =    2
integer, parameter :: LINE_CHNDSH =    3
integer, parameter :: LINE_CHNDOT =    4
integer, parameter :: LINE_DASHM  =    5
integer, parameter :: LINE_DOTL   =    6
integer, parameter :: LINE_DASHL  =    7

integer, parameter :: SHADING_NONE       =   -1
integer, parameter :: SHADING_EMPTY      =    0
integer, parameter :: SHADING_LINES      =    1
integer, parameter :: SHADING_LINES_BOLD =    4
integer, parameter :: SHADING_GRID       =   10
integer, parameter :: SHADING_GRID_BOLD  =   14
integer, parameter :: SHADING_FILLED     =   16
integer, parameter :: SHADING_DOTS       =   17

end module
