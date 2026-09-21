module GUI
implicit real*8 (a-h,o-z)

real*8 :: aug3D_main0=6D0

contains

subroutine selfilegui
end subroutine

subroutine drawmolgui
end subroutine

subroutine drawplanegui(init1,end1,init2,end2,init3,end3,idrawtype)
real*8,intent (in) :: init1,end1,init2,end2,init3,end3
integer,intent (in) :: idrawtype
end subroutine

subroutine drawisosurgui(iallowsetstyle)
integer,intent (in) :: iallowsetstyle
end subroutine

subroutine drawmoltopogui
end subroutine

subroutine drawsurfanalysis
end subroutine

subroutine drawbasinintgui
end subroutine

subroutine drawdomaingui
end subroutine

subroutine setboxGUI
end subroutine

subroutine miniGUI
end subroutine

subroutine drawvibgui(ispectrum,numdata,freqs,intens)
integer,intent(in) :: ispectrum,numdata
real*8,intent(in) :: freqs(numdata),intens(numdata)
end subroutine

end module
