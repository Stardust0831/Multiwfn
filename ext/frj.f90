!### Content of this file was contributed by frj, slightly adapted by Tian Lu
    
    
    
    
!!--------- frj modified version of subroutine calc_multipole, invoked by his MBIS code
!Calculate electric dipole/multipole moments and electronic spatial extent based on analytic integrals
subroutine calc_multipole_frj(lprint,moldipol,molquad,moloct,molhex)
use defvar
use util
implicit real*8 (a-h,o-z)
logical lprint
real*8 moldipol(3),molquad(6),moloct(10),molhex(15)

if (ispecial==1) then
    xnucdip=0
    ynucdip=0
    znucdip=0
    do iatm=1,ncenter
        xnucdip=xnucdip+a(iatm)%x*a(iatm)%charge
        ynucdip=ynucdip+a(iatm)%y*a(iatm)%charge
        znucdip=znucdip+a(iatm)%z*a(iatm)%charge
    end do
    write(*,"(/,' Dipole moment from nuclear charges (a.u.): ',3f11.6)") xnucdip,ynucdip,znucdip
    write(*,"(a)") " Because ispecial=1, now displacing nuclear coordinates to make their contributions to dipole moment vanishing"
    sumnuc=sum(a%charge)
    do iatm=1,ncenter
        a(iatm)%x=a(iatm)%x-xnucdip/sumnuc
        a(iatm)%y=a(iatm)%y-ynucdip/sumnuc
        a(iatm)%z=a(iatm)%z-znucdip/sumnuc
    end do
    write(*,*) "Done!"
end if

if (allocated(CObasa)) then
    write(*,"(a)") " Calculating electric dipole, quadruple, octopole and Hexadecapole moment integral matrix..."
    call genMultipolebas_curr

    xinttot=sum(Dbas(1,:,:)*Ptot(:,:))
    yinttot=sum(Dbas(2,:,:)*Ptot(:,:))
    zinttot=sum(Dbas(3,:,:)*Ptot(:,:))

    xxinttot=sum(Quadbas(1,:,:)*Ptot(:,:))
    yyinttot=sum(Quadbas(2,:,:)*Ptot(:,:))
    zzinttot=sum(Quadbas(3,:,:)*Ptot(:,:))
    xyinttot=sum(Quadbas(4,:,:)*Ptot(:,:))
    yzinttot=sum(Quadbas(5,:,:)*Ptot(:,:))
    xzinttot=sum(Quadbas(6,:,:)*Ptot(:,:))

    xxxinttot=sum(Octobas(1,:,:)*Ptot(:,:))
    yyyinttot=sum(Octobas(2,:,:)*Ptot(:,:))
    zzzinttot=sum(Octobas(3,:,:)*Ptot(:,:))
    yzzinttot=sum(Octobas(4,:,:)*Ptot(:,:))
    xzzinttot=sum(Octobas(5,:,:)*Ptot(:,:))
    xxzinttot=sum(Octobas(6,:,:)*Ptot(:,:))
    yyzinttot=sum(Octobas(7,:,:)*Ptot(:,:))
    xxyinttot=sum(Octobas(8,:,:)*Ptot(:,:))
    xyyinttot=sum(Octobas(9,:,:)*Ptot(:,:))
    xyzinttot=sum(Octobas(10,:,:)*Ptot(:,:))
    
    xxxxinttot=sum(Hexdebas(1,:,:)*Ptot(:,:))
    yyyyinttot=sum(Hexdebas(2,:,:)*Ptot(:,:))
    zzzzinttot=sum(Hexdebas(3,:,:)*Ptot(:,:))
    xxxyinttot=sum(Hexdebas(4,:,:)*Ptot(:,:))
    xxxzinttot=sum(Hexdebas(5,:,:)*Ptot(:,:))
    yyyxinttot=sum(Hexdebas(6,:,:)*Ptot(:,:))
    yyyzinttot=sum(Hexdebas(7,:,:)*Ptot(:,:))
    zzzxinttot=sum(Hexdebas(8,:,:)*Ptot(:,:))
    zzzyinttot=sum(Hexdebas(9,:,:)*Ptot(:,:))
    xxyyinttot=sum(Hexdebas(10,:,:)*Ptot(:,:))
    xxzzinttot=sum(Hexdebas(11,:,:)*Ptot(:,:))
    yyzzinttot=sum(Hexdebas(12,:,:)*Ptot(:,:))
    xxyzinttot=sum(Hexdebas(13,:,:)*Ptot(:,:))
    yyxzinttot=sum(Hexdebas(14,:,:)*Ptot(:,:))
    zzxyinttot=sum(Hexdebas(15,:,:)*Ptot(:,:))
    
else if (allocated(b)) then
    write(*,*) "Calculating density matrix based on GTFs..."
    call genPprim
    write(*,"(a)") " Calculating electric dipole, quadruple, octopole and Hexadecapole moment integral matrix..."
    call genMultipoleprim

    xinttot=sum(Dprim(1,:,:)*Ptot_prim(:,:))
    yinttot=sum(Dprim(2,:,:)*Ptot_prim(:,:))
    zinttot=sum(Dprim(3,:,:)*Ptot_prim(:,:))

    xxinttot=sum(Quadprim(1,:,:)*Ptot_prim(:,:))
    yyinttot=sum(Quadprim(2,:,:)*Ptot_prim(:,:))
    zzinttot=sum(Quadprim(3,:,:)*Ptot_prim(:,:))
    xyinttot=sum(Quadprim(4,:,:)*Ptot_prim(:,:))
    yzinttot=sum(Quadprim(5,:,:)*Ptot_prim(:,:))
    xzinttot=sum(Quadprim(6,:,:)*Ptot_prim(:,:))

    xxxinttot=sum(Octoprim(1,:,:)*Ptot_prim(:,:))
    yyyinttot=sum(Octoprim(2,:,:)*Ptot_prim(:,:))
    zzzinttot=sum(Octoprim(3,:,:)*Ptot_prim(:,:))
    yzzinttot=sum(Octoprim(4,:,:)*Ptot_prim(:,:))
    xzzinttot=sum(Octoprim(5,:,:)*Ptot_prim(:,:))
    xxzinttot=sum(Octoprim(6,:,:)*Ptot_prim(:,:))
    yyzinttot=sum(Octoprim(7,:,:)*Ptot_prim(:,:))
    xxyinttot=sum(Octoprim(8,:,:)*Ptot_prim(:,:))
    xyyinttot=sum(Octoprim(9,:,:)*Ptot_prim(:,:))
    xyzinttot=sum(Octoprim(10,:,:)*Ptot_prim(:,:))

    xxxxinttot=sum(Hexdeprim(1,:,:)*Ptot_prim(:,:))
    yyyyinttot=sum(Hexdeprim(2,:,:)*Ptot_prim(:,:))
    zzzzinttot=sum(Hexdeprim(3,:,:)*Ptot_prim(:,:))
    xxxyinttot=sum(Hexdeprim(4,:,:)*Ptot_prim(:,:))
    xxxzinttot=sum(Hexdeprim(5,:,:)*Ptot_prim(:,:))
    yyyxinttot=sum(Hexdeprim(6,:,:)*Ptot_prim(:,:))
    yyyzinttot=sum(Hexdeprim(7,:,:)*Ptot_prim(:,:))
    zzzxinttot=sum(Hexdeprim(8,:,:)*Ptot_prim(:,:))
    zzzyinttot=sum(Hexdeprim(9,:,:)*Ptot_prim(:,:))
    xxyyinttot=sum(Hexdeprim(10,:,:)*Ptot_prim(:,:))
    xxzzinttot=sum(Hexdeprim(11,:,:)*Ptot_prim(:,:))
    yyzzinttot=sum(Hexdeprim(12,:,:)*Ptot_prim(:,:))
    xxyzinttot=sum(Hexdeprim(13,:,:)*Ptot_prim(:,:))
    yyxzinttot=sum(Hexdeprim(14,:,:)*Ptot_prim(:,:))
    zzxyinttot=sum(Hexdeprim(15,:,:)*Ptot_prim(:,:))

else
    write(*,*) "Error: The current input file does not contain wavefunction information!"
    write(*,*) "Press ENTER button to return"
    read(*,*)
    return
end if

ESEx=-xxinttot
ESEy=-yyinttot
ESEz=-zzinttot

!Combine nuclear contribution and electron contribution to obtain multiple moments
xnucdip=0
ynucdip=0
znucdip=0
do iatm=1,ncenter
    xnucdip=xnucdip+a(iatm)%x*a(iatm)%charge
    ynucdip=ynucdip+a(iatm)%y*a(iatm)%charge
    znucdip=znucdip+a(iatm)%z*a(iatm)%charge
    xxinttot=xxinttot+a(iatm)%x*a(iatm)%x*a(iatm)%charge
    yyinttot=yyinttot+a(iatm)%y*a(iatm)%y*a(iatm)%charge
    zzinttot=zzinttot+a(iatm)%z*a(iatm)%z*a(iatm)%charge
    xyinttot=xyinttot+a(iatm)%x*a(iatm)%y*a(iatm)%charge
    yzinttot=yzinttot+a(iatm)%y*a(iatm)%z*a(iatm)%charge
    xzinttot=xzinttot+a(iatm)%x*a(iatm)%z*a(iatm)%charge
	xxxinttot=xxxinttot+a(iatm)%x*a(iatm)%x*a(iatm)%x*a(iatm)%charge
	yyyinttot=yyyinttot+a(iatm)%y*a(iatm)%y*a(iatm)%y*a(iatm)%charge
	zzzinttot=zzzinttot+a(iatm)%z*a(iatm)%z*a(iatm)%z*a(iatm)%charge
	yzzinttot=yzzinttot+a(iatm)%y*a(iatm)%z*a(iatm)%z*a(iatm)%charge
	xzzinttot=xzzinttot+a(iatm)%x*a(iatm)%z*a(iatm)%z*a(iatm)%charge
	xxzinttot=xxzinttot+a(iatm)%x*a(iatm)%x*a(iatm)%z*a(iatm)%charge
	yyzinttot=yyzinttot+a(iatm)%y*a(iatm)%y*a(iatm)%z*a(iatm)%charge
	xxyinttot=xxyinttot+a(iatm)%x*a(iatm)%x*a(iatm)%y*a(iatm)%charge
	xyyinttot=xyyinttot+a(iatm)%x*a(iatm)%y*a(iatm)%y*a(iatm)%charge
	xyzinttot=xyzinttot+a(iatm)%x*a(iatm)%y*a(iatm)%z*a(iatm)%charge
    xxxxinttot=xxxxinttot+a(iatm)%x*a(iatm)%x*a(iatm)%x*a(iatm)%x*a(iatm)%charge
    yyyyinttot=yyyyinttot+a(iatm)%y*a(iatm)%y*a(iatm)%y*a(iatm)%y*a(iatm)%charge
    zzzzinttot=zzzzinttot+a(iatm)%z*a(iatm)%z*a(iatm)%z*a(iatm)%z*a(iatm)%charge
    xxxyinttot=xxxyinttot+a(iatm)%x*a(iatm)%x*a(iatm)%x*a(iatm)%y*a(iatm)%charge
    xxxzinttot=xxxzinttot+a(iatm)%x*a(iatm)%x*a(iatm)%x*a(iatm)%z*a(iatm)%charge
    yyyxinttot=yyyxinttot+a(iatm)%y*a(iatm)%y*a(iatm)%y*a(iatm)%x*a(iatm)%charge
    yyyzinttot=yyyzinttot+a(iatm)%y*a(iatm)%y*a(iatm)%y*a(iatm)%z*a(iatm)%charge
    zzzxinttot=zzzxinttot+a(iatm)%z*a(iatm)%z*a(iatm)%z*a(iatm)%x*a(iatm)%charge
    zzzyinttot=zzzyinttot+a(iatm)%z*a(iatm)%z*a(iatm)%z*a(iatm)%y*a(iatm)%charge
    xxyyinttot=xxyyinttot+a(iatm)%x*a(iatm)%x*a(iatm)%y*a(iatm)%y*a(iatm)%charge
    xxzzinttot=xxzzinttot+a(iatm)%x*a(iatm)%x*a(iatm)%z*a(iatm)%z*a(iatm)%charge
    yyzzinttot=yyzzinttot+a(iatm)%y*a(iatm)%y*a(iatm)%z*a(iatm)%z*a(iatm)%charge
    xxyzinttot=xxyzinttot+a(iatm)%x*a(iatm)%x*a(iatm)%y*a(iatm)%z*a(iatm)%charge
    yyxzinttot=yyxzinttot+a(iatm)%y*a(iatm)%y*a(iatm)%x*a(iatm)%z*a(iatm)%charge
    zzxyinttot=zzxyinttot+a(iatm)%z*a(iatm)%z*a(iatm)%x*a(iatm)%y*a(iatm)%charge
end do
rrinttot=xxinttot+yyinttot+zzinttot
rrxinttot=xxxinttot+xyyinttot+xzzinttot
rryinttot=xxyinttot+yyyinttot+yzzinttot
rrzinttot=xxzinttot+yyzinttot+zzzinttot

!frj collect molecular dipole and quadrupole, and possibly print
moldipol(1) = xinttot+xnucdip
moldipol(2) = yinttot+ynucdip
moldipol(3) = zinttot+znucdip
molquad(1)  = xxinttot
molquad(2)  = xyinttot
molquad(3)  = xzinttot
molquad(4)  = yyinttot
molquad(5)  = yzinttot
molquad(6)  = zzinttot
moloct(1)  = xxxinttot
moloct(2)  = xxyinttot
moloct(3)  = xxzinttot
moloct(4)  = xyyinttot
moloct(5)  = xyzinttot
moloct(6)  = xzzinttot
moloct(7)  = yyyinttot
moloct(8)  = yyzinttot
moloct(9)  = yzzinttot
moloct(10)  = zzzinttot
molhex(1)  = xxxxinttot
molhex(2)  = xxxyinttot
molhex(3)  = xxxzinttot
molhex(4)  = xxyyinttot
molhex(5)  = xxyzinttot
molhex(6)  = xxzzinttot
molhex(7)  = yyyxinttot
molhex(8)  = yyxzinttot
molhex(9)  = zzxyinttot
molhex(10)  = zzzxinttot
molhex(11)  = yyyyinttot
molhex(12)  = yyyzinttot
molhex(13)  = yyzzinttot
molhex(14)  = zzzyinttot
molhex(15)  = zzzzinttot

if (lprint) then
    write(*,"(/,' X, Y, Z of center of positive charges (nuclear charges) in Angstrom',/,3f12.6)") &
    xnucdip/sum(a%charge)*b2a,ynucdip/sum(a%charge)*b2a,znucdip/sum(a%charge)*b2a
    write(*,"(' X, Y, Z of center of negative charges (electronic charges) in Angstrom',/,3f12.6)") &
    -xinttot/nelec*b2a,-yinttot/nelec*b2a,-zinttot/nelec*b2a

    write(*,"(/,' Dipole moment from nuclear charges (a.u.): ',3f11.6)") xnucdip,ynucdip,znucdip
    write(*,"(' Dipole moment from electrons (a.u.):       ',3f11.6)") xinttot,yinttot,zinttot
    xinttot=xinttot+xnucdip
    yinttot=yinttot+ynucdip
    zinttot=zinttot+znucdip
    write(*,*)
    write(*,"(' Dipole moment (a.u.): ',3f14.6)") xinttot,yinttot,zinttot
    write(*,"(' Dipole moment (Debye):',3f14.6)") xinttot*au2debye,yinttot*au2debye,zinttot*au2debye
    dipmag=sqrt(xinttot**2+yinttot**2+zinttot**2)
    write(*,"(' Magnitude of dipole moment:',f14.6,' a.u.',f14.6,' Debye')") dipmag,dipmag*au2debye
    write(*,*)
    write(*,*) "Note: All units given below are in a.u."
    write(*,"(/,' Quadrupole moments (Standard Cartesian form):')")
    fac=1
    !fac=au2debye*b2a !If using this factor, result will be identical to "Quadrupole moment (field-independent basis, Debye-Ang):" printed by Gaussian
    write(*,"(' XX=',f12.6,'  XY=',f12.6,'  XZ=',f12.6)") xxinttot*fac,xyinttot*fac,xzinttot*fac
    write(*,"(' YX=',f12.6,'  YY=',f12.6,'  YZ=',f12.6)") xyinttot*fac,yyinttot*fac,yzinttot*fac
    write(*,"(' ZX=',f12.6,'  ZY=',f12.6,'  ZZ=',f12.6)") xzinttot*fac,yzinttot*fac,zzinttot*fac
    write(*,"(' Quadrupole moments (Traceless Cartesian form):')")
    !If removing the comment, the data will be identical to "Traceless Quadrupole moment (field-independent basis, Debye-Ang)" printed by Gaussian
    QXX=(3*xxinttot-rrinttot)/2 !*au2debye*b2a/1.5D0
    QYY=(3*yyinttot-rrinttot)/2 !*au2debye*b2a/1.5D0
    QZZ=(3*zzinttot-rrinttot)/2 !*au2debye*b2a/1.5D0
    QXY=3*xyinttot/2            !*au2debye*b2a/1.5D0
    QXZ=3*xzinttot/2            !*au2debye*b2a/1.5D0
    QYZ=3*yzinttot/2            !*au2debye*b2a/1.5D0
    write(*,"(' XX=',f12.6,'  XY=',f12.6,'  XZ=',f12.6)") QXX,QXY,QXZ
    write(*,"(' YX=',f12.6,'  YY=',f12.6,'  YZ=',f12.6)") QXY,QYY,QYZ
    write(*,"(' ZX=',f12.6,'  ZY=',f12.6,'  ZZ=',f12.6)") QXZ,QYZ,QZZ
    write(*,"(' Magnitude of the traceless quadrupole moment tensor:',f12.6)") sqrt(2D0/3D0*(QXX**2+QYY**2+QZZ**2))
    R20=(3*zzinttot-rrinttot)/2D0 !Notice that the negative sign, because electrons carry negative charge
    R2n1=dsqrt(3D0)*yzinttot
    R2p1=dsqrt(3D0)*xzinttot
    R2n2=dsqrt(3D0)*xyinttot
    R2p2=dsqrt(3D0)/2D0*(xxinttot-yyinttot)
    write(*,"(' Quadrupole moments (Spherical harmonic form):')")
    write(*,"(' Q_2,0 =',f11.6,'   Q_2,-1=',f11.6,'   Q_2,1=',f11.6)") R20,R2n1,R2p1
    write(*,"(' Q_2,-2=',f11.6,'   Q_2,2 =',f11.6)") R2n2,R2p2
    write(*,"( ' Magnitude: |Q_2|=',f12.6)") dsqrt(R20**2+R2n1**2+R2p1**2+R2n2**2+R2p2**2)

    R30=(5*zzzinttot-3*rrzinttot)/2D0
    R3n1=dsqrt(3D0/8D0)*(5*yzzinttot-rryinttot)
    R3p1=dsqrt(3D0/8D0)*(5*xzzinttot-rrxinttot)
    R3n2=dsqrt(15D0)*xyzinttot
    R3p2=dsqrt(15D0)*(xxzinttot-yyzinttot)/2D0
    R3n3=dsqrt(5D0/8D0)*(3*xxyinttot-yyyinttot)
    R3p3=dsqrt(5D0/8D0)*(xxxinttot-3*xyyinttot)
    write(*,"(/,' Octopole moments (Cartesian form):')")
    fac=1
    !fac=au2debye*b2a*b2a !If using this factor, result will be identical to "Octapole moment (field-independent basis, Debye-Ang**2):" printed by Gaussian
    write(*,"(' XXX=',f10.4,'  YYY=',f10.4,'  ZZZ=',f10.4,'  XYY=',f10.4,'  XXY=',f10.4)") &
    xxxinttot*fac,yyyinttot*fac,zzzinttot*fac,xyyinttot*fac,xxyinttot*fac
    write(*,"(' XXZ=',f10.4,'  XZZ=',f10.4,'  YZZ=',f10.4,'  YYZ=',f10.4,'  XYZ=',f10.4)") &
    xxzinttot*fac,xzzinttot*fac,yzzinttot*fac,yyzinttot*fac,xyzinttot*fac
    write(*,"(' Octopole moments (Spherical harmonic form):')")
    write(*,"(' Q_3,0 =',f11.4,'  Q_3,-1=',f11.4,'  Q_3,1 =',f11.4)") R30,R3n1,R3p1
    write(*,"(' Q_3,-2=',f11.4,'  Q_3,2 =',f11.4,'  Q_3,-3=',f11.4,'  Q_3,3 =',f11.4)") R3n2,R3p2,R3n3,R3p3
    write(*,"( ' Magnitude: |Q_3|=',f12.4)") dsqrt(R30**2+R3n1**2+R3p1**2+R3n2**2+R3p2**2+R3n3**2+R3p3**2)

    !The outputting order is identical to Gaussian
    fac=1
    !fac=au2debye*b2a*b2a*b2a !If using this, result will be identical to "Hexadecapole moment (field-independent basis, Debye-Ang**3):" printed by Gaussian
    write(*,"(/,' Hexadecapole moments:')")
    write(*,"(' XXXX=',f16.4,'  YYYY=',f16.4,'  ZZZZ=',f16.4)") xxxxinttot*fac,yyyyinttot*fac,zzzzinttot*fac
    write(*,"(' XXXY=',f16.4,'  XXXZ=',f16.4,'  YYYX=',f16.4)") xxxyinttot*fac,xxxzinttot*fac,yyyxinttot*fac
    write(*,"(' YYYZ=',f16.4,'  ZZZX=',f16.4,'  ZZZY=',f16.4)") yyyzinttot*fac,zzzxinttot*fac,zzzyinttot*fac
    write(*,"(' XXYY=',f16.4,'  XXZZ=',f16.4,'  YYZZ=',f16.4)") xxyyinttot*fac,xxzzinttot*fac,yyzzinttot*fac
    write(*,"(' XXYZ=',f16.4,'  YYXZ=',f16.4,'  ZZXY=',f16.4)") xxyzinttot*fac,yyxzinttot*fac,zzxyinttot*fac

    ESE=ESEx+ESEy+ESEz
    write(*,"(/,a,f16.6)") " Electronic spatial extent <r^2>:",ESE
    write(*,"(' Components of <r^2>:  X=',f15.6,'  Y=',f15.6,'  Z=',f15.6)") ESEx,ESEy,ESEz

    !frj end print condition
end if

end subroutine

    
    
    
    
    
    
    
!!--------- Calculate MBIS charge or atomic radial density. Suitable for both isolated and periodic systems
!itype: 1=Calculate and print charges =2: Only generate atomic spaces, namely filling "atmraddens" global array by final radial density of each atom
!imode:
!0=Atomic center grid, only for isolated systems
!1=Evenly distributed grid, calculate actual density from periodic wavefunction
!2=Evenly distributed grid, actual density is directly taken from grid data in memory
subroutine MBIS_frj(itype,imode)
   use defvar
   use functions
   use util
   implicit real*8 (a-h,o-z)
   integer itype,imode
   type(content) gridatm(radpot*sphpot),gridatmorg(radpot*sphpot)
   real*8 charge(ncenter),lastcharge(ncenter) !Atomic charges of current iter. and last iter.
   real*8 beckeweigrid(radpot*sphpot),tvec(3)
   integer,parameter :: maxshell=6
   real*8 shpop(maxshell,ncenter),shsig(maxshell,ncenter) !Shell populations and shell sigma (width)
   real*8 shpopnew(maxshell,ncenter),shsignew(maxshell,ncenter) !New shell populations and shell sigma during iteration
   real*8 shpopnew_tmp(maxshell,ncenter),shsignew_tmp(maxshell,ncenter)
   real*8 rho0sh(maxshell,ncenter) !Shell density at current grid
   real*8 tmpdens(radpot*sphpot,ncenter) !tmpdens(ipt,iatm) corresponds to contribution of iatm to molecular density at grid ipt, and meantime multiplied by single-center integration weight at that point
   real*8 atmdis2min(ncenter)
   integer mshell(ncenter) !Actual number of shells of atoms
   integer :: maxcyc=100,ioutmedchg=0,ioutshell=0,ignorefar=1,ishellconv=0
   real*8 :: crit=0.0001D0,eps=1D-14,dencut=1D-10
!frj arrays for atomic and molecular multipoles
   real*8 shellchg(maxshell,ncenter), shelldip(3,maxshell,ncenter), shellquad(6,maxshell,ncenter)      ! shell charges, dipole and (Cartesian) quadrupole
   real*8 shelloct(10,maxshell,ncenter), shellhex(15,maxshell,ncenter)                                     ! shell octupole, hexadecapole
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter), achgold(ncenter) ! atomic charge, dipole and quadrupole, previous charges
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)              ! atomic octupole, hexadecapole
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4)                               ! reconstructed molecular charge, dipole and quadrupole
   real*8 moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)                       ! reconstructed molecular octupole, hexadecapole
   real*8 atomvolume(ncenter),bondorder(ncenter,ncenter)
!frj arrays for constrained MBIS
   logical lqconv,lgconv,lgaconv,lqmon,lgmon,lqstuck,lgstuck,lquit,lnumjacobi
   logical lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex
   logical lmult,lpmult
   real*8 dsinfo
   real*8 kappa(34),gkappa(34),jkappa(34,34),jinv(34,34),step(34)
   real*8 qhist(10),ghist(10)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)    ! the exact (reference) dipole, quadrupole, octupole, hexdecapole, as calculated by calc_multipole
   real*8 wtatm(maxshell,ncenter),jtatm(34,maxshell,ncenter)
   real*8 hkfunc(4,4,15),hjfunc(4,4,15),hhfunc(4,4,15)
! additional arrays for calculating Jacobian SVD
   real*8 umat(34,34),vmat(34,34),sigma(34)
   real*8 xmat(34,34),ymat(34,34)
! additional arrays for plotting density
   integer mplotcenter(ncenter)
   real*8 plotvector(ncenter,3,3)
! additional arrays for testing numerical vs. analytical Jacobian
   real*8 xxx(34,34),gtmp(2,34,34),jsave(34,34)
!frj: turn on numerical testing of the Jacobian, note that there are two additional places where this has to be turn on manually, search lnumjacobi to find these
!lnumjacobi=.true.
   lnumjacobi=.false.
!frj

   if (any(a%index>86)) then
      write(*,*) "Error: MBIS for atoms beyond Rn is not supported"
      write(*,*) "Press ENTER button to exit"
      read(*,*)
      return
   end if

   do while(.true.)
      write(*,*)
      call menutitle("(c)MBIS",15,2)
      if (ishellconv==0) write(*,*) "-5 Toggle convergence between charge and shell, current: charge"
      if (ishellconv==1) write(*,*) "-5 Toggle convergence between charge and shell, current: shell "
      if (ignorefar==1) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: Yes"
      if (ignorefar==0) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: No"
      if (ioutshell==1) write(*,*) "-2 Toggle if outputting population and width of shells, current: Yes"
      if (ioutshell==0) write(*,*) "-2 Toggle if outputting population and width of shells, current: No"
      if (ioutmedchg==1) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: Yes"
      if (ioutmedchg==0) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: No"
      write(*,*) "0 Return"
      write(*,*) "1 Start calculation!"
      write(*,"(a,i4)") " 2 Set the maximum number of iterations, current:",maxcyc
      write(*,"(a,f10.6)") " 3 Set convergence criterion of atomic charges, current:",crit
      read(*,*) isel
      if (isel==0) then
         return
      else if (isel==-5) then
         if (ishellconv==1) then
            ishellconv=0
         else
            ishellconv=1
         end if
      else if (isel==-4) then
         if (ignorefar==1) then
            ignorefar=0
         else
            ignorefar=1
         end if
      else if (isel==-2) then
         if (ioutshell==1) then
            ioutshell=0
         else
            ioutshell=1
         end if
      else if (isel==-1) then
         if (ioutmedchg==1) then
            ioutmedchg=0
         else
            ioutmedchg=1
         end if
      else if (isel==1) then
         exit
      else if (isel==2) then
         write(*,*) "Input maximum number of iterations, e.g. 30"
         read(*,*) maxcyc
      else if (isel==3) then
         write(*,*) "Input convergence criterion of atomic charges, e.g. 0.001"
         read(*,*) crit
      end if
   end do

!Prepare actual density of present system at integration points
   if (imode==0) then !Atomic center grids, only for isolated systems
      call walltime(iwalltime1)
      ntotpot=radpot*sphpot
      call gen1cintgrid(gridatmorg,iradcut)
      write(*,"(' Radial grids:',i4,'  Angular grids:',i5,'  Total:',i7,'  After pruning:',i7)") radpot,sphpot,radpot*sphpot,radpot*sphpot-iradcut*sphpot
      write(*,"(a)") " Calculating atomic contribution to electron density of present system on grid points..."
      ifinish=0
      call showprog(ifinish,ncenter)
      !$OMP PARALLEL DO SHARED(tmpdens,ifinish) PRIVATE(iatm,gridatm,beckeweigrid,dtmp) schedule(dynamic) NUM_THREADS(nthreads)
      do iatm=1,ncenter
         gridatm%value=gridatmorg%value
         gridatm%x=gridatmorg%x+a(iatm)%x
         gridatm%y=gridatmorg%y+a(iatm)%y
         gridatm%z=gridatmorg%z+a(iatm)%z
         call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
         do ipt=1+iradcut*sphpot,ntotpot
            dtmp = fdens(gridatm(ipt)%x,gridatm(ipt)%y,gridatm(ipt)%z)
            tmpdens(ipt,iatm) = dtmp*gridatm(ipt)%value*beckeweigrid(ipt)
         end do
         !$OMP CRITICAL
         ifinish=ifinish+1
         call showprog(ifinish,ncenter)
         !$OMP END CRITICAL
      end do
      !$OMP END PARALLEL DO
   else if (imode==1) then !Calculate density from periodic wavefunction
      call setgrid_for_PBC(0.2D0,1)
      call calc_dvol(dvol)
      if (allocated(cubmat)) deallocate(cubmat)
      allocate(cubmat(nx,ny,nz))
      call walltime(iwalltime1)
      write(*,*) "Calculating electron density grid data..."
      !Because uniform grid cannot integrate well core density, so temporarily disable EDFs
      nEDFprims_org=nEDFprims
      nEDFprims=0
      call delvirorb(1) !Delete high-lying virtual orbitals for faster calculation
      call savecubmat(1,0,1)
      call delvirorb_back(1) !Restore to previous wavefunction
      nEDFprims=nEDFprims_org
   else !Directly using loaded electron density from cub/VASP grid data, and transforming grid data information to cell information
      if (all(a%charge==0)) then
         write(*,*) "Error: All nuclear charges are zero! If this file was exported by CP2K, it is a bug. You need to manually &
            edit the file so that effective nuclear charges (column 2 since line 8) are correctly recorded, otherwise atomic charges cannot be calculated"
         write(*,*) "Press ENTER button to return"
         read(*,*)
         return
      end if
      call grid2cellinfo
      call calc_dvol(dvol)
      !call showcellinfo
      call walltime(iwalltime1)
   end if

!Set initial sigma and population of various shells
   shpop(:,:)=0
   icore=1 !If consider core shells. If =0, initial population of core shells will be 0, and core shells will not be utilized during iteration (population and sigma will be zero throughout iterations)
!For density only representing valence electrons, I found ignoring core shells do not improve convergence. After first several iterations, core population automatically decreases to nearly zero
   do iatm=1,ncenter
      iele = a(iatm)%index
      if (iele==0) then !Ghost atom, initialize as shsig=1 and with a tiny population. This scheme is defined by frj
!frj bug fix in the original code
!        mshell=0
!        shsig(1,iatm) = 1
!        shpop(1,iatm)=1D-3
! frj turn off ignorefar since atmrhocutsqr has no suitable value for ghost atoms
         ignorefar = 0
         mshell(iatm)=1
         shsig(1,iatm) = 1.0d0
         shpop(1,iatm)=1D-3
      else if (iele<=2) then
         mshell(iatm) = 1
         shsig(1,iatm) = 1D0/(2*iele)
         shpop(1,iatm)=iele
      else if (iele<=10) then
!frj shell testing for double valence shell
!        mshell(iatm) = 3
!        shsig(1,iatm) = 1D0/(2*iele)
!        shsig(2,iatm) = 0.8d0*1D0/2
!        shsig(3,iatm) = 1.2d0*1D0/2
!        if (icore==1) shpop(1,iatm)=2
!        shpop(2,iatm)=1.2d0*(iele-2)
!        shpop(3,iatm)=0.8d0*(iele-2)
!frjshell
         mshell(iatm) = 2
         shsig(1,iatm) = 1D0/(2*iele)
         shsig(2,iatm) = 1D0/2
         if (icore==1) shpop(1,iatm)=2
         shpop(2,iatm)=iele-2
      else if (iele<=18) then
         mshell(iatm) = 3
         shsig(1,iatm) = 1D0/(2*iele)
         shsig(2,iatm) = 1D0/(2*sqrt(dfloat(iele)))
         shsig(3,iatm) = 1D0/2
         if (icore==1) shpop(1,iatm)=2
         if (icore==1) shpop(2,iatm)=8
         shpop(3,iatm)=iele-10
      else if (iele<=36) then
         mshell(iatm) = 4
         shsig(1,iatm) = 1D0/(2*iele)
         do ishell=2,3
            shsig(ishell,iatm) = 1D0/(2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
         end do
         shsig(4,iatm) = 1D0/2
         if (icore==1) shpop(1,iatm)=2
         if (icore==1) shpop(2,iatm)=8
         if (icore==1) shpop(3,iatm)=8
         shpop(4,iatm)=iele-18
      else if (iele<=54) then
         mshell(iatm) = 5
         shsig(1,iatm) = 1D0/(2*iele)
         do ishell=2,4
            shsig(ishell,iatm) = 1D0/(2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
         end do
         shsig(5,iatm) = 1D0/2
         if (icore==1) shpop(1,iatm)=2
         if (icore==1) shpop(2,iatm)=8
         if (icore==1) shpop(3,iatm)=8
         if (icore==1) shpop(4,iatm)=18
         shpop(5,iatm)=iele-36
      else if (iele<=86) then
         mshell(iatm) = 6
         shsig(1,iatm) = 1D0/(2*iele)
         do ishell=2,5
            shsig(ishell,iatm) = 1D0/(2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
         end do
         shsig(6,iatm) = 1D0/2
         if (icore==1) shpop(1,iatm)=2
         if (icore==1) shpop(2,iatm)=8
         if (icore==1) shpop(3,iatm)=8
         if (icore==1) shpop(4,iatm)=18
         if (icore==1) shpop(5,iatm)=18
         shpop(6,iatm)=iele-54
      end if
   end do

   write(*,*)
   write(*,*) "Performing MBIS iterations to refine atomic spaces..."
   lastcharge=0


! lmult turns on all multipole calculations when close to convergence
!       this saves ~10% computational time compared to calculating them in each MBIS iteration
   lmult=.false.

   do icyc=1,maxcyc
      if (ioutmedchg==1) write(*,*)
      if (icyc==1) then
         write(*,"(' Cycle',i5)") icyc
      else
         write(*,"(' Cycle',i5,'   Maximum change:',f12.8)") icyc,varmax
      end if

      !Monitor population and width of shells
      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpop(1:mshell(iatm),iatm))
      !end do
      !write(*,*) "Width (sigma) of each shell in Bohr"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm),ish=1,mshell(iatm))
      !end do

      shpopnew(:,:)=0 !New population of shells of various atoms
      shsignew(:,:)=0 !New sigma of shells of various atoms
!       frj initialization for shell multipoles
      shellchg = 0.0d0
      shelldip = 0.0d0
      shellquad = 0.0d0
      shelloct  = 0.0d0
      shellhex  = 0.0d0
      dsinfo = 0.0d0
!       frj initialization for atomic volumen and atom-atom bond order
      atomvolume = 0.0d0
      bondorder = 0.0d0
! frj
      if (imode==0) then !Using multicenter integration to evaluate population of various shells of various atoms based on present sigma (Eq. 18 of MBIS paper)
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            ! frj
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)     ! frj
            do ipt=1+iradcut*sphpot,ntotpot
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     sigval = shsig(ishell,jatm)
                     tmp = shpop(ishell,jatm)/sigval**3/8/pi*exp(-dis/sigval) !Eq. 7 of MBIS paper
                     if (tmp<dencut) tmp = 0 !I don't know why frj introduced this criterion. Seems that this can make insignificant grid ignored and reduce cost (because of wtot>0)?
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do
               !Accumulate contribution of this integration grid to new population and sigma of shells
               tmpden = tmpdens(ipt,iatm)
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     dx = gridatm(ipt)%x - a(jatm)%x
                     dy = gridatm(ipt)%y - a(jatm)%y
                     dz = gridatm(ipt)%z - a(jatm)%z
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis  = dsqrt(dis2)
                     dis3 = dis2*dis
                     dstmp  = 0.0d0          ! frj
                     do ishell=1,mshell(jatm)
                        shpopnew(ishell,jatm) = shpopnew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/rho0 !Eq. 18 of MBIS paper
                        shsignew(ishell,jatm) = shsignew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/rho0*dis !Integral part of Eq. 19 of MBIS paper
! frj                                                   generate atomic multipoles and dSinfo
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/rho0
                        atomvolume(jatm) = atomvolume(jatm) + dis3*wtmp
                        shellchg(ishell,jatm) = shellchg(ishell,jatm) + wtmp
! frj:                                                  calculate multipoles only if close to convergence, this saves some time
                        if (lmult) call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,shelldip,shellquad,shelloct,shellhex)
! frj:                                                  accumulate bond order
                        do katm=1,ncenter
                           do kshell=1,mshell(katm)
                              wjtmp = rho0sh(ishell,jatm)/rho0
                              wktmp = rho0sh(kshell,katm)/rho0
                              bondorder(jatm,katm) = bondorder(jatm,katm) + wjtmp*wktmp*tmpden
!                                                                        write(*,"(4i5,3d15.4)")jatm,ishell,katm,kshell,wjtmp,wktmp,tmpden
                           enddo
                        enddo
                     end do
!                                               actual density: rho1
!                                               model density:  rho2
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo = dsinfo + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do

      else !Using evenly distributed grids
         ifinish=0
         ntmp=floor(ny*nz/100D0)
         !$OMP PARALLEL SHARED(shpopnew,shsignew,ifinish,ishowprog) PRIVATE(shpopnew_tmp,shsignew_tmp,i,j,k,rho0sh,rho0,tmpx,tmpy,tmpz,tvec, &
         !$OMP ic,jc,kc,icell,jcell,kcell,iatm,dx,dy,dz,dis,dis2,dis2min,ishell,sigval,tmp,tmp2,tmp3,tmpden,atmdis2min) NUM_THREADS(nthreads)
         shpopnew_tmp(:,:)=0
         shsignew_tmp(:,:)=0
         !$OMP DO schedule(dynamic) collapse(2)
         do k=1,nz
            do j=1,ny
               do i=1,nx
                  if (cubmat(i,j,k)<1D-10) cycle
                  rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
                  rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
                  call getgridxyz(i,j,k,tmpx,tmpy,tmpz)
                  !call getpointcell(tmpx,tmpy,tmpz,ic,jc,kc)
                  atmdis2min(:)=1D10
                  do icell=-PBCnx,+PBCnx
                     do jcell=-PBCny,+PBCny
                        do kcell=-PBCnz,+PBCnz
                           call tvec_PBC(icell,jcell,kcell,tvec)
                           do iatm=1,ncenter
                              dx=a(iatm)%x+tvec(1)-tmpx
                              dy=a(iatm)%y+tvec(2)-tmpy
                              dz=a(iatm)%z+tvec(3)-tmpz
                              dis2=dx*dx+dy*dy+dz*dz
                              if (dis2<atmdis2min(iatm)) atmdis2min(iatm)=dis2
                              if (dis2>atmrhocutsqr(a(iatm)%index)) cycle !Ignore atoms that do not contribute notably to present grid
                              dis=dsqrt(dis2)
                              do ishell=1,mshell(iatm)
                                 sigval = shsig(ishell,iatm)
                                 if (sigval==0) cycle
                                 tmp = shpop(ishell,iatm)/sigval**3/8/pi*exp(-dis/sigval) !Eq. 7 of MBIS paper
                                 rho0sh(ishell,iatm) = rho0sh(ishell,iatm) + tmp
                                 rho0 = rho0 + tmp
                              end do
                           end do
                        end do
                     end do
                  end do

                  !Accumulate contribution of this integration grid to new population and sigma of shells
                  tmpden = cubmat(i,j,k)*dvol
                  if (rho0>0.and.tmpden>eps) then
                     do iatm=1,ncenter
                        tmp2=tmpden/rho0
                        tmp3=tmp2*dsqrt(atmdis2min(iatm))
                        do ishell=1,mshell(iatm)
                           shpopnew_tmp(ishell,iatm) = shpopnew_tmp(ishell,iatm) + tmp2*rho0sh(ishell,iatm) !Eq. 18 of MBIS paper
                           shsignew_tmp(ishell,iatm) = shsignew_tmp(ishell,iatm) + tmp3*rho0sh(ishell,iatm) !Integral part of Eq. 19 of MBIS paper
                        end do
                     end do
                  end if
               end do
               !$OMP CRITICAL
               ifinish=ifinish+1
               ishowprog=mod(ifinish,ntmp)
               if (ishowprog==0) call showprog(floor(100D0*ifinish/(ny*nz)),100)
               !$OMP END CRITICAL
            end do
         end do
         !$OMP END DO
         !$OMP CRITICAL
         shpopnew(:,:)=shpopnew(:,:)+shpopnew_tmp(:,:)
         shsignew(:,:)=shsignew(:,:)+shsignew_tmp(:,:)
         !$OMP END CRITICAL
         !$OMP END PARALLEL
         if (ishowprog/=0) call showprog(100,100)
      end if

      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpopnew(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpopnew(1:mshell(iatm),iatm))
      !end do
      !write(*,*) "Width (sigma) of each shell in Bohr"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsignew(ish,iatm),ish=1,mshell(iatm))
      !end do
      !   write(*,*) "--------------------------"

      !Include prefix part of Eq. 19 of MBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            if (shpopnew(ish,iatm)>0) shsignew(ish,iatm)=shsignew(ish,iatm)/(3*shpopnew(ish,iatm))
         end do
      end do

      !Summing up shell populations to atomic population and get atomic charge
      do iatm=1,ncenter
         tmppop=sum(shpopnew(1:mshell(iatm),iatm)) !Atomic population
         if (nEDFelec==0.or.imode>0) then !Note that EDFs were not involved in evaluating system density when using even grids (imode>0)
            charge(iatm) = a(iatm)%charge - tmppop
         else !EDF is used for some atoms. Core electron density represented by EDF has been integrated, so nuclear charge should be augmented by nEDFelecatm
            charge(iatm) = a(iatm)%charge+nEDFelecatm(iatm) - tmppop
         end if
         if (ioutmedchg==1) write(*,"(i5,'(',a,')   charge:',f12.6)") iatm,a(iatm)%name,charge(iatm)
      end do

!Check convergence, choice between converging on charges (sum of shell-populations) or shell-sigma (inverse exponents)
      varmax=maxval(abs(charge(:)-lastcharge(:)))
      varsig=maxval(abs(shsignew(:,:)-shsig(:,:)))
!       frj: turn on multipole calculation if approaching convergence
      if (varmax<10.0d0*crit .and. ishellconv==0) lmult=.true.
      if (varsig<10.0d0*crit .and. ishellconv==1) lmult=.true.
!       be careful if tight convergence has been requested
      if (varmax<1.0d-4 .and. ishellconv==0) lmult=.true.
      if (varsig<1.0d-4 .and. ishellconv==1) lmult=.true.
!
!frj : orginal code
!	if (varmax<crit.or.icyc==maxcyc) then
!                if (varmax<crit) write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
!                if (icyc==maxcyc) write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
!		exit
!	end if
!frj : new code, introducing convergence on shsig
      if (icyc==maxcyc) then
         write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
         exit
      end if
      if (varmax<crit .and. ishellconv==0) then
         write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
         exit
      end if
      if (varsig<crit .and. ishellconv==1) then
         write(*,"(/,a,f10.6)") " All atomic shell sigmas have converged to criterion of",crit
         exit
      end if

      !Update atomic charges, shell population and sigma
      lastcharge(:)=charge(:)
      shpop(:,:)=shpopnew(:,:)
      shsig(:,:)=shsignew(:,:)
   end do

   write(*,"(' Sum of all raw charges:',f14.8)") sum(charge(:))
!Normalize atomic charges. This is not feasible if only grid data is available, &
!because in this case the nelec used in "normalize_atmchg" is simply guessed by assuming system is neutral
   if (imode==1) call normalize_atmchg(charge(:))
!Print final atomic charges
   call printatmchg(charge(:))

   write(*,*)' '
   write(*,*)' Atomic volumes, defined as Int(r^3*rho), in au'
   do iatm=1,ncenter
      write(*,"(i5,f12.6)")iatm,atomvolume(iatm)
   enddo
   write(*,*)' '
   write(*,*)' Bond order matrix, only values larger than 0.05 are printed'
   do iatm=1,ncenter-1
      do jatm=iatm+1,ncenter
         tmp = bondorder(iatm,jatm)
         if (tmp.gt.0.05d0) write(*,"(2i5,f12.4)")iatm,jatm,tmp
!                write(*,*)iatm,jatm,tmp
      enddo
   enddo

   if (allocated(frag1)) then
      write(*,"(/,' Fragment charge:',f14.8)") sum(charge(frag1))
      write(*,"(' Fragment population:',f14.8)") sum(a(frag1)%charge) - sum(charge(frag1))
   end if

   if (ioutshell==1) then
      write(*,*)
      write(*,*) "Population of each shell"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,mshell(iatm))
      end do
      write(*,*)
      write(*,*) "Width (sigma) of each shell in Bohr"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm),ish=1,mshell(iatm))
      end do
!frj
      write(*,*) "Alpha of each shell in Bohr-1"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(1.0d0/shsig(ish,iatm),ish=1,mshell(iatm))
      end do
!frj
   end if

   call walltime(iwalltime2)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime2-iwalltime1

   if (itype==1) then !Output charges
      call outatmchg(10,charge(:))
   else if (itype==2) then !Generate radial density of every atom
      if (allocated(atmradnpt)) deallocate(atmradnpt)
      if (allocated(atmraddens)) deallocate(atmraddens)
      allocate(atmradnpt(ncenter),atmraddens(200,ncenter))
      do iatm=1,ncenter
         do ipt=1,200
            tmprho=0
            do ishell=1,mshell(iatm)
               sigval=shsig(ishell,iatm)
               tmprho = tmprho + shpop(ishell,iatm)/sigval**3/8/pi*exp(-atmradpos(ipt)/sigval)
            end do
            atmraddens(ipt,iatm)=tmprho
            if (tmprho<1D-8) then !Electron density truncation
               atmradnpt(iatm)=ipt
               exit
            end if
         end do
      end do
      write(*,*) "Construction of MBIS atomic spaces has been finished!"
   end if


!frj generate exact results for printing and for later possible constrained MBIS
   call calc_multipole_frj(.false.,moldipol,molquad,moloct,molhex)
! calculate traceless form for printing purposes
!       Stone/Buckingham style traceless
   molquadt = 3.0d0*molquad
   trace = molquad(1) + molquad(4) + molquad(6)
   molquadt(1) = molquadt(1) - trace
   molquadt(4) = molquadt(4) - trace
   molquadt(6) = molquadt(6) - trace
   molquadt = molquadt/2.0d0

   moloctt  = 5.0d0*moloct
   tracex = moloct(1) + moloct(4) + moloct(6)
   tracey = moloct(2) + moloct(7) + moloct(9)
   tracez = moloct(3) + moloct(8) + moloct(10)
   moloctt(1)  = moloctt(1)  - 3.0d0*tracex
   moloctt(2)  = moloctt(2)  - tracey
   moloctt(3)  = moloctt(3)  - tracez
   moloctt(4)  = moloctt(4)  - tracex
   moloctt(6)  = moloctt(6)  - tracex
   moloctt(7)  = moloctt(7)  - 3.0d0*tracey
   moloctt(8)  = moloctt(8)  - tracez
   moloctt(9)  = moloctt(9)  - tracey
   moloctt(10) = moloctt(10) - 3.0d0*tracez
   moloctt  = moloctt/2.0d0

   molhext = 35.0d0*molhex
   trace   = molhex(1) + molhex(11) + molhex(15)
   trace   = trace + 2.0d0*( molhex(4) + molhex(6) + molhex(13) )
   tracexx = molhex(1) + molhex(4)  + molhex(6)
   tracexy = molhex(2) + molhex(7)  + molhex(9)
   tracexz = molhex(3) + molhex(8)  + molhex(10)
   traceyy = molhex(4) + molhex(11) + molhex(13)
   traceyz = molhex(5) + molhex(12) + molhex(14)
   tracezz = molhex(6) + molhex(13) + molhex(15)
   molhext(1)  = molhext(1)  - 30.0d0*tracexx + 3.0d0*trace
   molhext(2)  = molhext(2)  - 15.0d0*tracexy
   molhext(3)  = molhext(3)  - 15.0d0*tracexz
   molhext(4)  = molhext(4)  -  5.0d0*(tracexx + traceyy) + trace
   molhext(5)  = molhext(5)  -  5.0d0*traceyz
   molhext(6)  = molhext(6)  -  5.0d0*(tracexx + tracezz) + trace
   molhext(7)  = molhext(7)  - 15.0d0*tracexy
   molhext(8)  = molhext(8)  -  5.0d0*tracexz
   molhext(9)  = molhext(9)  -  5.0d0*tracexy
   molhext(10) = molhext(10) - 15.0d0*tracexz
   molhext(11) = molhext(11) - 30.0d0*traceyy + 3.0d0*trace
   molhext(12) = molhext(12) - 15.0d0*traceyz
   molhext(13) = molhext(13) -  5.0d0*(traceyy + tracezz) + trace
   molhext(14) = molhext(14) - 15.0d0*traceyz
   molhext(15) = molhext(15) - 30.0d0*tracezz + 3.0d0*trace
   molhext = molhext/8.0d0

   write(*,*)
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo
   write(*,*)' '
   write(*,*)' MBIS multipole moments up to rank 4'
   write(*,*)' '
! frj condense to atomic and molecular quantities
   call condensempl(.true.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
! frj and possibly write to file
   call outatommpl(10,2,maxshell,mshell(:),shpop(:,:),shsig(:,:),achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:) )

! frj: ask for (expensive) double integration
   write(*,"(a)") " Proceed to double numerical integration to get Vne and Vee (warning: expensive!)? 0=no, 1=yes"
   read(*,*) itmp
   if (itmp.eq.1) call dblint(mshell,shpop,shsig)

! frj proceed to determine constrained MBIS?
   write(*,*)' '
   write(*,"(a)") " Proceed to decompose with multipole constraints?"
   write(*,"(a)") "-10: skip and continue to plot density"
   write(*,"(a)") "  0: No"
   write(*,"(a)") " 10: Constrain Molecular Dipole                                               by Atomic Charges"
   write(*,"(a)") " 20: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges"
   write(*,"(a)") " 21: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges, Dipoles"
   write(*,"(a)") " 30: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges"
   write(*,"(a)") " 31: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles"
   write(*,"(a)") " 32: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 40: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges"
   write(*,"(a)") " 41: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles"
   write(*,"(a)") " 42: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 43: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles, Octupoles"
   read(*,*) itmp
   if (itmp.eq.-10) goto 788
   if (itmp.ne.10 .and. itmp.ne.20 .and. itmp.ne.21 .and. itmp.ne.30 .and. itmp.ne.31 .and. itmp.ne.32 .and. itmp.ne.40 .and.  itmp.ne.41 .and. itmp.ne.42 .and. itmp.ne.43) return

   lcdip=.false.
   lcquad=.false.
   ldquad=.false.
   lcoct=.false.
   ldoct=.false.
   lqoct=.false.
   lchex=.false.
   ldhex=.false.
   lqhex=.false.
   lohex=.false.

   if (itmp.eq.10 .or. itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)         lcdip  = .true.
   if (itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)                         lcquad = .true.
   if (itmp.eq.30 .or. itmp.eq.40)                                         lcoct  = .true.
   if (itmp.eq.40)                                                         lchex  = .true.

   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcdip  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         lcoct  = .true.
   if (itmp.eq.41)                                                         lchex  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         ldquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         ldoct  = .true.
   if (itmp.eq.41)                                                         ldhex  = .true.

   if (itmp.eq.32 .or. itmp.eq.42)                                         lcdip  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcoct  = .true.
   if (itmp.eq.42)                                                         lchex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldoct  = .true.
   if (itmp.eq.42)                                                         ldhex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lqoct  = .true.
   if (itmp.eq.42)                                                         lqhex  = .true.

   if (itmp.eq.43)                                                         lcdip  = .true.
   if (itmp.eq.43)                                                         lcquad = .true.
   if (itmp.eq.43)                                                         lcoct  = .true.
   if (itmp.eq.43)                                                         lchex  = .true.
   if (itmp.eq.43)                                                         ldquad = .true.
   if (itmp.eq.43)                                                         ldoct  = .true.
   if (itmp.eq.43)                                                         ldhex  = .true.
   if (itmp.eq.43)                                                         lqoct  = .true.
   if (itmp.eq.43)                                                         lqhex  = .true.
   if (itmp.eq.43)                                                         lohex  = .true.

! determine effective dimension of constraints, this actually saves some time
   ndimcon = 0
   if (lcdip) ndimcon = ndimcon + 3
   if (lcquad .or. ldquad) ndimcon = ndimcon + 6
   if (lcoct .or. ldoct .or. lqoct) ndimcon = ndimcon + 10
   if (lchex .or. ldhex .or. lqhex .or. lohex) ndimcon = ndimcon + 15
!write(*,*)'ndimcon =',ndimcon

   write(*,"(a,3f9.4)")'Reference molecular dipole      ',(moldipol(i),i=1,3)
   write(*,"(a,6f9.4)")'Reference traceless quadrupole  ',(molquadt(i),i=1,6)
   write(*,"(a,10f9.3)")'Reference traceless octupole    ',(moloctt(i),i=1,10)
   write(*,"(a,15f9.2)")'Reference traceless hexadecapole',(molhext(i),i=1,15)
   write(*,*)' '

! determine number of constraints and warn the user of some likely constraint failures
! charge is always conserved:
   nconstr = 1
   if (lcdip) nconstr = nconstr + 3
   if (lcquad .or. ldquad) nconstr = nconstr + 5
   if (lcoct .or. ldoct .or. lqoct) nconstr = nconstr + 7
   if (lchex .or. ldhex .or. lqhex .or. lohex) nconstr = nconstr + 9
   nparam = ncenter
   if (ldquad .or. ldoct .or. ldhex) nparam = nparam + 3*ncenter
   if (lqoct .or. lqhex) nparam = nparam + 5*ncenter
   if (lohex) nparam = nparam + 7*ncenter
   write(*,"(a,i5)")' Number of constraints       = ',nconstr
   write(*,"(a,i5)")' Number of atomic parameters = ',nparam
   if (nconstr .gt. nparam) write(*,"(a)")' WARNING! More constraints than free atomic parameters!'

! for testing, the exact dipole and quadrupole can be replaced with the reconstructed, as this makes the atomic to molecular multipole contribution zero to within the numerical noise
!do i=1,3
!   moldipol(i)=mdip(i,3)
!enddo
!do i=1,6
!   molquad(i)=mquad(i,4)
!   molquadt(i)=mquadt(i,4)
!enddo
!write(*,"(a,3f15.8)")'Reconstru molecular dipole     moments',(moldipol(i),i=1,3)
!write(*,"(a,6f15.8)")'Reconstru molecular quadrupole moments',(molquad(i),i=1,6)
!write(*,"(a,6f15.8)")'Reconstru traceless quadrupole moments',(molquadt(i),i=1,6)

! frj   this version calculates the new NAi and sigmaAi parameters in each kappa iteration, but they are only used if the kappa iterations has converged
!       this avoids the construction of a separate grid integration for these parameters, when the kappa iterations has converged
!       thus, a slight increase in the computational cost for each kappa iteration, but saving a grid integration for updating NAi and sigmaAi
!       the computational cost appears slightly larger, but the code is cleaner
!
! reuse maxcyc as safeguard for parameter iteration, this should (hopefully) be an overestimate
! set a small number of fixed number of kappa iterations (10), this should converge fast
!       if not, it is probably better to update the MBIS parameters, rather than spend more time on converging the constraints
!       one could consider always only doing one kappa iteration before parameter update, but that requires change in the code logic to detect proper convergence
!       currently a couple of other criteria are used for deciding whether to abandon the kappa iteration in favor of MBIS update (see later)
! set convergence criteria for the atomic charges to be the user specified in the regular MBIS
! set the gkappa convergence to factor 2 lower, and introduce a maximum kappa step, smax, as a safeguard
   kappamax=10
   qconv = crit
   gconv = 0.5d0*crit
   smax  = 1.0d-1

! initialize the Lagrange multiplier as zero
   kappa = 0.0d0
! for testing numerical vs. analytical Jacobian, test non-zero kappa values
!kappa = 0.001d0

! initialize the old charges as the regular MBIS
   achgold=achg(1,:)

! initialize the q (charge) history, for deciding if the decomposition fails, likely due to insufficient grid
   qhist=0.0d0

! lmult turns on all multipole calculations when close to convergence, otherwise only the necessary are calculated
! lpmult monitors lmult from the previous macro iteration, an ugly hack to prevent multipoles not being calculated in some rare cases
   lmult=.false.
   lpmult=.false.

! the outer loop for updating the MBIS parameters when kappa has been updated to make the constraints zero
! for testing numerical vs. analytical Jacobian, only one iteration
   if (lnumjacobi) maxcyc=1
   do kpar=1,maxcyc
      lpmult=lmult

! initialize the gkappa history, for deciding if the constraints fail, likely due to insufficient grid
      ghist=0.0d0

! the inner loop for iterating kappa to fulfill the multipole constraints
! for testing numerical vs. analytical Jacobian, only one iteration, and assign numerical stepsize
      if (lnumjacobi) then
         kappamax=1
         gstep=1.0d-4
         gtmp=0.0d0
      endif
      do ikappa=1,kappamax

! lnumjacobi: turn next 5 lines on for testing numerical vs. analytical Jacobian, this must be done manually
!do knum=0,ndimcon
!  do kkk=1,2
!    if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)-gstep
!    if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)+gstep
!    write(*,*)'progress',knum,kkk


! initiate the Jacobian
         jkappa = 0.0d0

! frj re-use code structure from the above MBIS iteration to calculate cMBIS
         shellchg  = 0.0d0
         shelldip  = 0.0d0
         shellquad = 0.0d0
         shelloct  = 0.0d0
         shellhex  = 0.0d0
         dsinfo    = 0.0d0
         shpopnew(:,:)=0 !New population of shells of various atoms
         shsignew(:,:)=0 !New sigma of shells of various atoms
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
            do ipt=1+iradcut*sphpot,ntotpot
               gx = gridatm(ipt)%x
               gy = gridatm(ipt)%y
               gz = gridatm(ipt)%z
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     sigval = shsig(ishell,jatm)
                     tmp = shpop(ishell,jatm)/sigval**3/8/pi*exp(-dis/sigval) !Eq. 7 of MBIS paper
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do

!               frj: construct the equivalent of rho0 for the re-weighting, this is the denominator for the atomic shell weights collected in wtatm
               wtatm=0.0d0
!               frj: the wa derivatives for the Jacobian collected in jtatm, first collect the numerator in the wa term
               jtatm=0.0d0
!               katm loop over all atoms A and constructs the nominator for the re-weighting
               do katm=1,ncenter
                  rxk = a(katm)%x
                  ryk = a(katm)%y
                  rzk = a(katm)%z
                  dgkx = gx - rxk
                  dgky = gy - ryk
                  dgkz = gz - rzk
!                       calculate the multipole geometry functions for atom katm
                  call makehfunc(rxk,ryk,rzk,dgkx,dgky,dgkz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hkfunc)

                  do kshell=1,mshell(katm)
                     wtmp = 0.0d0
!                               jatm loop to collect the contribtions from all the other atoms in terms of distance
                     do jatm=1,ncenter
                        rxj = a(jatm)%x
                        ryj = a(jatm)%y
                        rzj = a(jatm)%z
                        dgjx = gx - rxj
                        dgjy = gy - ryj
                        dgjz = gz - rzj
!                                       calculate the multipole geometry functions for atom jatm
                        call makehfunc(rxj,ryj,rzj,dgjx,dgjy,dgjz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hjfunc)
!                                       charge-dipole term
                        dtmp = 0.0d0
                        if (lcdip) then
                           do i=1,3
                              dtmp = dtmp + kappa(i)*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                           enddo
                        end if
!                                       charge-quadrupole term
                        qtmp = 0.0d0
                        if (lcquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                           enddo
                        end if
!                                       dipole-quadrupole term
                        if (ldquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                           enddo
                        end if
!                                       charge-octupole term
                        otmp = 0.0d0
                        if (lcoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                           enddo
                        end if
!                                       dipole-octupole term
                        if (ldoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                           enddo
                        end if
!                                       quadrupole-octupole term
                        if (lqoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                           enddo
                        end if
!                                       charge-hexadecapole term
                        htmp = 0.0d0
                        if (lchex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                           enddo
                        end if
!                                       dipole-hexadecapole term
                        if (ldhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                           enddo
                        end if
!                                       quadrupole-hexadecapole term
                        if (lqhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                           enddo
                        end if
!                                       octupole-hexadecapole term
                        if (lohex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                           enddo
                        end if
!                                       frj: warning note: if the grid point is far from the molecule, the above geometry functions
!                                       can be large, and then even with small kappa, (especially) the htmp can become so large that
!                                       the following xtmp becomes infinite, resulting in subsequent properties giving NaN
!                                       a test case that showed this was two water molecules 9 Ang appart
!                                       This does not seem reasonable, and there should probably be some test on the grid-to-atom
!                                       distance, and skipping if this is large, but not clear how
!                                       The failure is rare, and thus no effort has been put into solving this so far...
                        xtmp = exp(dtmp+qtmp+otmp+htmp)
                        do ishell=1,mshell(jatm)
                           tmp = rho0sh(ishell,jatm)
                           wtmp = wtmp + xtmp*tmp
                           if (jatm.ne.katm) then
!                                                   charge-dipole term
                              if (lcdip) then
                                 do i=1,3
                                    jtatm(i,kshell,katm) = jtatm(i,kshell,katm) + xtmp*tmp*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                                 enddo
                              end if
!                                                   charge-quadrupole term
                              if (lcquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                                 enddo
                              end if
!                                                   dipole-quadrupole term
                              if (ldquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                                 enddo
                              end if
!                                                   charge-octupole term
                              if (lcoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                                 enddo
                              end if
!                                                   dipole-octupole term
                              if (ldoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                                 enddo
                              end if
!                                                   quadrupole-octupole term
                              if (lqoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                                 enddo
                              end if
!                                                   charge-hexdecapole term
                              if (lchex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                                 enddo
                              end if
!                                                   dipole-hexdecapole term
                              if (ldhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                                 enddo
                              end if
!                                                   quadrupole-hexdecapole term
                              if (lqhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                                 enddo
                              end if
!                                                   octupole-hexdecapole term
                              if (lohex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                                 enddo
                              end if
                           end if
                        end do
                     end do
!                               denominator complete
                     wtatm(kshell,katm) = wtmp
!                               now complete the wa derivatives, note the minus sign
                     rtmp = rho0sh(kshell,katm)
!                               wtmp should always be close to 1, but safeguarding anyway....
                     if (wtmp.gt.eps) then
                        do i=1,ndimcon
                           jtatm(i,kshell,katm) = -jtatm(i,kshell,katm)*rtmp/(wtmp**2)
                        end do
                     end if
                  end do
               end do
!               jtatm now has the dwa/dkappa derivative

!               Accumulate contribution of this integration grid to density contribution
!               calculate the shell atomic multipole moments to be used for the g-functions
               tmpden = tmpdens(ipt,iatm)
!               keep rho0 as the deciding cutoff factor, this should be safe
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     gx = gridatm(ipt)%x
                     gy = gridatm(ipt)%y
                     gz = gridatm(ipt)%z
                     rx = a(jatm)%x
                     ry = a(jatm)%y
                     rz = a(jatm)%z
                     dx = gx-rx
                     dy = gy-ry
                     dz = gz-rz
!                               calculate multipole geometry functions
                     call makehfunc(rx,ry,rz,dx,dy,dz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hhfunc)
!
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis=dsqrt(dis2)
                     dstmp  = 0.0d0
                     do ishell=1,mshell(jatm)
                        shpopnew(ishell,jatm) = shpopnew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm) !Eq. 18 of MBIS paper
                        shsignew(ishell,jatm) = shsignew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm)*dis !Integral part of Eq. 19 of MBIS paper
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm)
                        shellchg(ishell,jatm) = shellchg(ishell,jatm) + wtmp
! frj: lmult only calculates the necessary multipoles, except when close to convergence
                        call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,shelldip,shellquad,shelloct,shellhex)

!                                       the Jacobian, the h function to be multiplied with the dwa/dkappa derivative
                        do i=1,ndimcon
                           rr = 0.0d0
!                                          charge-dipole term
                           if (lcdip) then
                              if (i.ge.1 .and. i.le.3) rr = rr + hhfunc(1,1,i)
                           end if
!                                          charge-quadrupole term
                           if (lcquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(1,2,i-3)
                           end if
!                                          dipole-quadrupole term
                           if (ldquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(2,2,i-3)
                           end if
!                                          charge-octupole term
                           if (lcoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(1,3,i-9)
                           end if
!                                          dipole-octupole term
                           if (ldoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(2,3,i-9)
                           end if
!                                          quadrupole-octupole term
                           if (lqoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(3,3,i-9)
                           end if
!                                          charge-hexdecapole term
                           if (lchex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(1,4,i-19)
                           end if
!                                          dipole-hexdecapole term
                           if (ldhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(2,4,i-19)
                           end if
!                                          quadrupole-hexdecapole term
                           if (lqhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(3,4,i-19)
                           end if
!                                          octupole-hexdecapole term
                           if (lohex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(4,4,i-19)
                           end if
                           do j=1,ndimcon
                              jkappa(i,j) = jkappa(i,j) + rr*jtatm(j,ishell,jatm)*tmpden
                           end do
                        end do
                     end do
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo = dsinfo + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do
!write(*,*)' dSInfo = ',dsinfo

!frj condense shell contributions to atomic and molecular quantities
         call condensempl(.false.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
!
         if (kpar.eq.1 .and. ikappa.eq.1 .and. .not.lnumjacobi) then
            write(*,"(a,f12.6)")' Atomic charge        convergence = ',qconv
            write(*,"(a,f12.6)")' Multipole constraint convergence = ',gconv
            write(*,"(a,f12.6)")' Kappa step max                   = ',smax
            write(*,*)' '
            write(*,"(a)")'  MBIS kappa   gnorm       dCmax'
         end if
!frj calculate the g-functions: the errors in the multipole components
!       the error is relative to the sum of atomic multipoles included
!       test for convergence
         lgconv=.true.
         g1norm = 0.0d0
         g2norm = 0.0d0
         g3norm = 0.0d0
         g4norm = 0.0d0
         gkappa = 0.0d0
         if (lcdip) then
            do i=1,3
               tmp = moldipol(i) - mdip(i,1)
               gkappa(i) = tmp
               g1norm = g1norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcquad .or. ldquad) then
            do i=1,6
               if (ldquad) then
                  tmp = molquadt(i) - (mquadt(i,1) + mquadt(i,2))
               else
                  tmp = molquadt(i) - (mquadt(i,1))
               end if
               gkappa(i+3) = tmp
               g2norm = g2norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcoct .or. ldoct .or. lqoct) then
            do i=1,10
               if (lqoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2) + moctt(i,3))
               else if (ldoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2))
               else if (lcoct) then
                  tmp = moloctt(i) - (moctt(i,1))
               end if
               gkappa(i+9) = tmp
               g3norm = g3norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lchex .or. ldhex .or. lqhex .or. lohex) then
            do i=1,15
               if (lohex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3) + mhext(i,4))
               else if (lqhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3))
               else if (ldhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2))
               else if (lchex) then
                  tmp = molhext(i) - (mhext(i,1))
               end if
               gkappa(i+19) = tmp
               g4norm = g4norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         g1norm = g1norm/3.0d0
         g2norm = g2norm/6.0d0
         g3norm = g3norm/10.0d0
         g4norm = g4norm/15.0d0
!write(*,*)'g1,g2,g3,g4 norm',g1norm,g2norm,g3norm,g4norm

! the next section turned for testing numerical vs. analytical Jacobian
         if (lnumjacobi) then
            if (knum.gt.0) then
               do j=1,ndimcon
                  gtmp(kkk,knum,j)=gkappa(j)
               enddo
            endif
            if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)+gstep
            if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)-gstep
            if (knum.eq.0 .and. kkk.eq.1) then
               jsave=jkappa
               write(*,*)'jkappa anal'
               do i=1,ndimcon
                  write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
               enddo
            endif
         endif

! lnumjacobi: turn on the next two lines that closes the numerical loop, must be turned on manually
!  enddo
!enddo

         if (lnumjacobi) then
            write(*,*)'jkappa num'
            do i=1,ndimcon
               do j=1,ndimcon
                  xxx(j,i)=(gtmp(2,i,j)-gtmp(1,i,j))/(2.0d0*gstep)
               enddo
            enddo
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,(xxx(i,j),j=1,ndimcon)
            enddo
            write(*,*)'jkappa anal-num'
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,((jsave(i,j)-xxx(i,j)),j=1,ndimcon)
            enddo
            itmp = 0
            jtmp = 0
            tmpm = 0.0d0
            itmpa = 0
            jtmpa = 0
            tmpma = 0.0d0
            do i=1,ndimcon
               do j=1,ndimcon
                  tmp = abs(jsave(i,j)-xxx(i,j))
                  if (tmp.gt.tmpm) then
                     itmp=i
                     jtmp=j
                     tmpm=tmp
                  endif
                  tmp = abs(jsave(i,j)-jsave(j,i))
                  if (tmp.gt.tmpma) then
                     itmpa=i
                     jtmpa=j
                     tmpma=tmp
                  endif
               enddo
            enddo
            write(*,*)'max diff =',tmpm,itmp,jtmp
            write(*,*)'max asym =',tmpma,itmpa,jtmpa
         endif
!end num Jacobian


! max change in atomic charges for printing
         dCmax=maxval(abs(achg(1,:)-achgold(:)))

! print info in the current MBIS-kappa iteration
         if (lcdip                                 ) write(*,"(2i5,2f12.6,5x,a,15f12.6)")kpar,ikappa,g1norm,dCmax,'kappa dip :',(kappa(i),i=1,3)
         if (lcquad .or. ldquad                    ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g2norm,'kappa quad:',(kappa(i),i=4,9)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g3norm,'kappa oct :',(kappa(i),i=10,15)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(74x,15f12.6)")(kappa(i),i=16,19)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g4norm,'kappa hex :',(kappa(i),i=20,27)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(62x,15f12.6)")(kappa(i),i=28,34)

         if (lgconv) then
!   write(*,"(a,f12.6)")' All multipole constraints converged to within',gconv
            goto 900
         endif

! solve for the next kappa
! this, in principle, could be done by a call to pseudoinverse, but this employs a fixed 10^-10 criteria for small being zero,
!       and grid noise may lead to zero singular values being larger than that.
! call pseudoinverse(jkappa,jinv)
! use instead a direct version of pseudoinverse
! determine SVD Jacobian
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
!enddo
         call SVDmat(1,jkappa,umat,vmat,sigma,info)
         if (info.ne.0) then
            write(*,*)'WARNING! SVD of Jacobian failed'
         endif
!write(*,"(a,34d15.4)")'SVD sigma',(sigma(j),j=1,ndimcon)

! in the absence of symmetry there should be nconstraint-1 (charge conservation is always in place) non-zero eigenvalues,
!       but some of the rest could be non-zero due to grid noise from the traceless conditions, and some of the non-zero could be zero due to symmetry
! use a conservative svdcut criteria for deciding when small is zero, and make sure the gap position is valid...
         svdcut=1.0d-3
         ntmp=0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) ntmp=ntmp+1
         enddo
! if only dipole constraint, then there should be no a priori zero eigenvalues, and thus ntmp = ndimcon
         if (ntmp.lt.ndimcon) then
            tmp1 = sigma(ntmp)
            tmp2 = sigma(ntmp+1)
            tmp3 = 1.0d9
            if (abs(tmp2).gt.1.0d-12) tmp3=abs(tmp1/tmp2)
!       add a warning if no clear eigenvalue gap
            if (tmp3 .lt. 1.0d2) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: no clear eigenvalue gap'
               write(*,"(a)")' either the system has (near) symmetry or grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            end if
            if (ntmp.gt.nconstr-1) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: more non-zero than constraints'
               write(*,"(a)")' the grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            endif
!       enforce constraint eigenvalues to be zero
            do j=ntmp+1,ndimcon
               sigma(j) = 0.0d0
            end do
         endif
! we have explicit forced eigenvalues to zero, but keep svdcut just for good measure
         xmat=0.0d0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) xmat(i,i)=1.0d0/sigma(i)
         enddo
         jinv=matmul(matmul(vmat,xmat),transpose(umat))
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jinv(i,j),j=1,ndimcon)
!enddo

! calculate the step and update kappa
         sums=0.0d0
         do i=1,ndimcon
            tmp = 0.0d0
            do j=1,ndimcon
               tmp = tmp +jinv(i,j)*gkappa(j)
            enddo
!   write(*,"(a,i5,f12.6)")' step',i,-tmp
            step(i) = -tmp
            sums=sums+tmp*tmp
         enddo
         sums=dsqrt(sums)
!write(*,*)' step length',sums
         if (sums.gt.smax) then
            write(*,"(a,f12.6,a,f12.6)")' step',sums,' scaled down to',smax
!  write(*,*)sums
            sums=smax/sums
            step = sums*step
         endif

         tmpg1=g1norm
         tmpg2=g2norm
         tmpg3=g3norm
         tmpg4=g4norm
         if (.not.lcdip)  tmpg1=0.0d0
         if (.not.lcquad .and. .not.ldquad) tmpg2=0.0d0
         if (.not.lcoct .and. .not.ldoct .and. .not.lqoct) tmpg3=0.0d0
         if (.not.lchex .and. .not.ldhex .and. .not.lqhex .and. .not.lohex) tmpg4=0.0d0
         tmpg = tmpg1 + tmpg2 + tmpg3 + tmpg4
         ghist(ikappa)=tmpg
!write(*,*)'g1,g2,g3,g4',tmpg1,tmpg2,tmpg3,tmpg4,tmpg
!write(*,*)'ghist'
!do i=1,ikappa
!        write(*,*)i,ghist(i)
!enddo

! frj: try to decide whether it is better to proceed to update the MBIS, than spending more time on the kappa...
         lgmon=.true.
         lgstuck=.false.
         if (ikappa.ge.3) then
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
            igmon=0
            do i=1,ikappa-1
               tmp = ghist(i)/ghist(i+1)
               if (tmp.lt.1.0d0) igmon=igmon+1
            end do
            if (igmon.ge.1) lgmon=.false.
!       if the last 3 iterations have made little progress, then it is stuck ...
            ghmax=0.0d0
            gsum =0.0d0
            do i=ikappa-2,ikappa
               tmp = ghist(i)
               if (tmp.gt.ghmax) ghmax=tmp
               gsum = gsum + tmp
            end do
            aveg = gsum/3.0d0
!       be more patient if close to convergence, indicated by lmult=.true.
            if (.not.lmult .and. ghmax.lt.2.0d0*aveg) lgstuck=.true.
            if (lmult .and. ghmax.lt.1.5d0*aveg) lgstuck=.true.
         end if

!write(*,*)'lmult,lgconv,lgmon,lgstuck',ikappa,lmult,lgconv,lgmon,lgstuck

         if (lgstuck .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' little g-improvements last 3 steps, proceeding to update MBIS parameters'
            goto 900
         end if

         if (tmpg.lt.2.0d0*gconv .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' g-norm is less than ',2.0d0*gconv,' and little improvements, proceeding to update MBIS parameters'
            goto 900
         end if

         if (ikappa.eq.kappamax) then
            write(*,"(a,i5,a)")' Failure to converge multipole constraints in iterations',kappamax,'   proceeding to update MBIS parameters'
            goto 900
         end if

         kappa = kappa + step

! end ikappa iterations
      end do

900   continue
!Include prefix part of Eq. 19 of MBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            if (shpopnew(ish,iatm)>0) shsignew(ish,iatm)=shsignew(ish,iatm)/(3*shpopnew(ish,iatm))
         end do
      end do

!   update MBIS parameters and go for new kappa iteration
      shpop(:,:)=shpopnew(:,:)
      shsig(:,:)=shsignew(:,:)

      dCmax=maxval(abs(achg(1,:)-achgold(:)))
      lqconv=.false.
      if (dCmax.lt.qconv) lqconv=.true.

! turn on full multipole calculation if approaching convergence
      if (dCmax.lt.10.0d0*qconv) lmult=.true.
! be careful if tight convergence has been requested
      if (dCmax.lt.1.0d-4) lmult=.true.
! if lmult for some reason has not been turned on, but lqconv is true, reset it to go for one more cycle
      if (lqconv .and. .not.lmult) then
         lqconv=.false.
         lmult=.true.
      endif
! if lpmult is false, then all appears good, but no multipoles have been calculated, reset and go for one more cycle
      if (lqconv .and. lmult .and. .not.lpmult) then
         lqconv=.false.
         lmult=.true.
      endif

      tmpg = g1norm + g2norm + g3norm + g4norm

! try to decide from the history whether the decomposion is stuck due to insufficient numerical accuracy
! if less than 10 iterations, then just collect the information
! if more than 10 iterations, and nothing has changed for the last 10 iterations, make the decission to quit
! nothing is here defined as q is not converged, no monotonic convergence, and ratio of max to ave values is less than 3
      lqmon=.true.
      lqstuck=.false.
      lquit=.false.
      if (kpar.le.10) then
         qhist(kpar)=dCmax
      else
         do i=1,9
            qhist(i)=qhist(i+1)
         end do
         qhist(10)=dCmax
         qhmax=maxval(qhist(:))
         aveq = sum(qhist(:))/size(qhist(:))
         if (qhmax.lt.3.0d0*aveq) lqstuck=.true.
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
         iqmon=0
         do i=1,9
            tmp = qhist(i)/qhist(i+1)
            if (tmp.lt.1.0d0) iqmon=iqmon+1
         end do
         if (iqmon.ge.3) lqmon=.false.
      end if

!write(*,*)'lqconv,lqmon,lqstuck',lqconv,lqmon,lqstuck

      g1max = 0.0d0
      g2max = 0.0d0
      g3max = 0.0d0
      g4max = 0.0d0
      do i=1,3
         if (abs(gkappa(i)).gt.g1max) then
            g1max=abs(gkappa(i))
         endif
      enddo
      do i=4,9
         if (abs(gkappa(i)).gt.g2max) then
            g2max=abs(gkappa(i))
         endif
      enddo
      do i=10,19
         if (abs(gkappa(i)).gt.g3max) then
            g3max=abs(gkappa(i))
         endif
      enddo
      do i=20,34
         if (abs(gkappa(i)).gt.g4max) then
            g4max=abs(gkappa(i))
         endif
      enddo

      lgaconv=.true.
      if (g1norm.gt.gconv) lgaconv=.false.
      if (g2norm.gt.gconv) lgaconv=.false.
      if (g3norm.gt.gconv) lgaconv=.false.
      if (g4norm.gt.gconv) lgaconv=.false.

! now try to make decissions ...
      if (lqconv .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         goto 901
      end if
      if (lqconv .and. .not.lgconv .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if
      if (lqstuck .and. .not. lgmon .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         lquit=.true.
      end if
      if (lqstuck .and. .not.lqmon .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if

      if (lquit) then
!        write(*,"(a,2f12.6)")' Very little C and G progress in the last 10 iterations'
!        do i=1,10
!                write(*,"(i5,2f12.6)")kpar-10+i,qhist(i),ghist(i)
!        end do
         write(*,"(a,2f12.6)")' Decomposition appears stuck, deciding to quit ...'
         write(*,"(a,2f12.6)")' Likely reason(s): insufficient grid accuracy or more constraints than atomic parameters'
         write(*,*)' '
         goto 901
      end if

      if (kpar.eq.maxcyc) then
         write(*,"(a,i5)")' Failure to converge atomic charges and constraints in iterations',maxcyc
         goto 901
      end if
      achgold=achg(1,:)
! end kpar loop for updating cMBIS parameters
   end do

901 continue

! output the final constrained results
   call outatommpl(10,4,maxshell,mshell(:),shpop(:,:),shsig(:,:),achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:) )
! make final check that the sum of NAi matches the QA
   do iatm=1,ncenter
      tmp = 0.0d0
      do ishell=1,mshell(iatm)
         tmp = tmp + shpop(ishell,iatm)
      end do
      electmp = a(iatm)%charge - achg(1,iatm)
      if (abs(tmp-electmp).gt.crit) then
         write(*,"(a,i5,3f12.6)") 'normalization problem?',iatm,tmp,electmp
      end if
   end do

   write(*,*)' '
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo

   call walltime(iwalltime3)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime3-iwalltime2


!frj optionally, read in a set of nuclei and directions along which to plot the atomic electron density
788 continue
   write(*,*)'Proceed to plot density along given directions? 0=no, 1=yes'
   read(*,*)itmp
   if (itmp .eq. 0) return
   open(80,status="old",err=789)
   read(80,*)nplotcenter,nstride,stride
   write(*,*)'par',nplotcenter,nstride,stride
   if (nplotcenter.gt.ncenter) then
      write(*,*)' too many plot points, max = ncenter',nplotcenter,ncenter
      stop
   endif
   do i=1,nplotcenter
      read(80,*)itmp
      mplotcenter(i)=itmp
      do k=1,3
         read(80,*)(plotvector(i,k,j),j=1,3)
      enddo
   enddo
   close(80)

   write(*,*)'dumping density plot on fort.81'
   open(81,status="replace")
   do i=1,nplotcenter
      iatm = mplotcenter(i)
      write(81,*)'plotcenter =',iatm
      do k=1,3
         write(81,'(a,i5,3f15.8)')' direction =',k,(plotvector(i,k,j),j=1,3)
         do np=0,nstride
            xp = a(iatm)%x + dble(np)*stride*plotvector(i,k,1)
            yp = a(iatm)%y + dble(np)*stride*plotvector(i,k,2)
            zp = a(iatm)%z + dble(np)*stride*plotvector(i,k,3)
!                       actual density at this point
            dtmp = fdens(xp,yp,zp)
!                       find the MBIS atomic weight
            rho0=0.0d0
            rhoa=0.0d0
            do jatm=1,ncenter
               dx = xp - a(jatm)%x
               dy = yp - a(jatm)%y
               dz = zp - a(jatm)%z
               dis2 = dx*dx + dy*dy + dz*dz
               dis = dsqrt(dis2)
               do ishell=1,mshell(jatm)
                  sigval = shsig(ishell,jatm)
                  tmp = shpop(ishell,jatm)/sigval**3/8/pi*exp(-dis/sigval)
!					rho0sh(ishell,jatm) = tmp
                  rho0 = rho0 + tmp
                  if (jatm.eq.iatm) rhoa = rhoa + tmp
               end do
            end do
            wtmp = rhoa/rho0
            write(81,'(i5,3f15.8,5x,3d15.6)')np,xp,yp,zp,wtmp,dtmp,wtmp*dtmp
         enddo
      enddo
   enddo
   close(81)


   return
789 continue
   write(*,*)' fort.80 file not found'

!end plot part

end subroutine




!!============================ EMBIS ============================!!
!!============================ EMBIS ============================!!
!!============================ EMBIS ============================!!
!!============================ EMBIS ============================!!
!!============================ EMBIS ============================!!

!!--------- Calculate EMBIS charge or atomic radial density. Suitable for both isolated and periodic systems
!itype: 1=Calculate and print charges =2: Only generate atomic spaces, namely filling "atmraddens" global array by final radial density of each atom
!imode:
!0=Atomic center grid, only for isolated systems
!1=Evenly distributed grid, calculate actual density from periodic wavefunction
!2=Evenly distributed grid, actual density is directly taken from grid data in memory
subroutine EMBIS(itype,imode)
   use defvar
   use functions
   use util
   implicit real*8 (a-h,o-z)
   integer itype,imode
   type(content) gridatm(radpot*sphpot),gridatmorg(radpot*sphpot)
   real*8 charge(ncenter),lastcharge(ncenter) !Atomic charges of current iter. and last iter.
   real*8 beckeweigrid(radpot*sphpot),tvec(3)
   integer,parameter :: maxshell=6
   real*8 shpop(maxshell,ncenter),shsig(maxshell,ncenter,3,3),shalpha(maxshell,ncenter,3,3)  !Shell populations and shell sigma (width)
   real*8 shpopnew(maxshell,ncenter),shsignew(maxshell,ncenter,3,3), shalphanew(maxshell,ncenter,3,3) !New shell populations and shell sigma during iteration
   real*8 shpopnew_tmp(maxshell,ncenter),shsignew_tmp(maxshell,ncenter,3,3), shalpha_tmp(maxshell,ncenter,3,3)
   real*8 shbeta(maxshell,ncenter,3),shbeta_rot(maxshell,ncenter,3)
   real*8 rho0sh(maxshell,ncenter) !Shell density at current grid
   real*8 tmpdens(radpot*sphpot,ncenter) !tmpdens(ipt,iatm) corresponds to contribution of iatm to molecular density at grid ipt, and meantime multiplied by single-center integration weight at that point
   real*8 atmdis2min(ncenter)
   real*8 det, g,N,xa,xs
   integer mshell(ncenter),Nummer,skal !Actual number of shells of atoms
   integer :: maxcyc=200,ioutmedchg=0,ioutshell=0,ignorefar=1,ishellconv=0,initembis=0
   real*8 :: crit=0.0001D0,eps=1D-14,dencut=1D-10
!frj arrays for atomic and molecular multipoles
   real*8 shellchg(maxshell,ncenter), shelldip(3,maxshell,ncenter), shellquad(6,maxshell,ncenter)      ! shell charges, dipole and (Cartesian) quadrupole
   real*8 shelloct(10,maxshell,ncenter), shellhex(15,maxshell,ncenter)                                     ! shell octupole, hexadecapole
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter), achgold(ncenter) ! atomic charge, dipole and quadrupole, previous charges
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)              ! atomic octupole, hexadecapole
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4)                               ! reconstructed molecular charge, dipole and quadrupole
   real*8 moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)                       ! reconstructed molecular octupole, hexadecapole
   real*8 atomvolume(ncenter),bondorder(ncenter,ncenter)
!frj arrays for constrained MBIS
   logical lqconv,lgconv,lgaconv,lqmon,lgmon,lqstuck,lgstuck,lquit,lnumjacobi
   logical lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex
   logical lmult,lpmult
   real*8 dsinfo
   real*8 kappa(34),gkappa(34),jkappa(34,34),jinv(34,34),step(34)
   real*8 qhist(10),ghist(10)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)    ! the exact (reference) dipole, quadrupole, octupole, hexdecapole, as calculated by calc_multipole
   real*8 wtatm(maxshell,ncenter),jtatm(34,maxshell,ncenter)
   real*8 hkfunc(4,4,15),hjfunc(4,4,15),hhfunc(4,4,15)
! additional arrays for calculating Jacobian SVD
   real*8 umat(34,34),vmat(34,34),sigma(34)
   real*8 xmat(34,34),ymat(34,34)
! additional arrays for testing numerical vs. analytical Jacobian
   real*8 xxx(34,34),gtmp(2,34,34),jsave(34,34)
   character (len=200) :: line, navn
!frj: turn on numerical testing of the Jacobian, note that there are two additional places where this has to be turn on manually, search lnumjacobi to find these
!lnumjacobi=.true.
   lnumjacobi=.false.
!frj

   if (any(a%index>86)) then
      write(*,*) "Error: MBIS for atoms beyond Rn is not supported"
      write(*,*) "Press ENTER button to exit"
      read(*,*)
      return
   end if

    shbeta(maxshell,ncenter,3)=0  !Useless arrays, simply initializing to 0
    shbeta_rot(maxshell,ncenter,3)=0
   
   do while(.true.)
      write(*,*)
      call menutitle("EMBIS",15,2)
      if (ishellconv==0) write(*,*) "-5 Toggle convergence between charge and shell, current: charge"
      if (ishellconv==1) write(*,*) "-5 Toggle convergence between charge and shell, current: shell "
      if (ignorefar==1) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: Yes"
      if (ignorefar==0) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: No"
      if (initembis==0) write(*,"(a)") " -3 Toggle initial EMBIS parameters, default or MBIS parameters, current: default"
      if (initembis==1) write(*,"(a)") " -3 Toggle initial EMBIS parameters, default or MBIS parameters, current: MBIS"
      if (ioutshell==1) write(*,*) "-2 Toggle if outputting population and width of shells, current: Yes"
      if (ioutshell==0) write(*,*) "-2 Toggle if outputting population and width of shells, current: No"
      if (ioutmedchg==1) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: Yes"
      if (ioutmedchg==0) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: No"
      write(*,*) "0 Return"
      write(*,*) "1 Start calculation!"
      write(*,"(a,i4)") " 2 Set the maximum number of iterations, current:",maxcyc
      write(*,"(a,f10.6)") " 3 Set convergence criterion of atomic charges, current:",crit
      read(*,*) isel
      if (isel==0) then
         return
      else if (isel==-5) then
         if (ishellconv==1) then
            ishellconv=0
         else
            ishellconv=1
         end if
      else if (isel==-4) then
         if (ignorefar==1) then
            ignorefar=0
         else
            ignorefar=1
         end if
      else if (isel==-3) then
         if (initembis==1) then
            initembis=0
         else
            initembis=1
            write(*,*) "name of mbis.mpl file?"
            read(*,*) filename
         end if
      else if (isel==-2) then
         if (ioutshell==1) then
            ioutshell=0
         else
            ioutshell=1
         end if
      else if (isel==-1) then
         if (ioutmedchg==1) then
            ioutmedchg=0
         else
            ioutmedchg=1
         end if
      else if (isel==1) then
         exit
      else if (isel==2) then
         write(*,*) "Input maximum number of iterations, e.g. 30"
         read(*,*) maxcyc
      else if (isel==3) then
         write(*,*) "Input convergence criterion of atomic charges, e.g. 0.001"
         read(*,*) crit
      end if
   end do

!Prepare actual density of present system at integration points
   if (imode==0) then !Atomic center grids, only for isolated systems
      call walltime(iwalltime1)
      ntotpot=radpot*sphpot
      call gen1cintgrid(gridatmorg,iradcut)
      write(*,"(' Radial grids:',i4,'  Angular grids:',i5,'  Total:',i7,'  After pruning:',i7)") radpot,sphpot,radpot*sphpot,radpot*sphpot-iradcut*sphpot
      write(*,"(a)") " Calculating atomic contribution to electron density of present system on grid points..."
      ifinish=0
      call showprog(ifinish,ncenter)
      !$OMP PARALLEL DO SHARED(tmpdens,ifinish) PRIVATE(iatm,gridatm,beckeweigrid,dtmp) schedule(dynamic) NUM_THREADS(nthreads)
      do iatm=1,ncenter
         gridatm%value=gridatmorg%value
         gridatm%x=gridatmorg%x+a(iatm)%x
         gridatm%y=gridatmorg%y+a(iatm)%y
         gridatm%z=gridatmorg%z+a(iatm)%z
         call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
         do ipt=1+iradcut*sphpot,ntotpot
            dtmp = fdens(gridatm(ipt)%x,gridatm(ipt)%y,gridatm(ipt)%z)
            tmpdens(ipt,iatm) = dtmp*gridatm(ipt)%value*beckeweigrid(ipt)
         end do
         !$OMP CRITICAL
         ifinish=ifinish+1
         call showprog(ifinish,ncenter)
         !$OMP END CRITICAL
      end do
      !$OMP END PARALLEL DO
   else if (imode==1) then !Calculate density from periodic wavefunction
      call setgrid_for_PBC(0.2D0,1)
      call calc_dvol(dvol)
      if (allocated(cubmat)) deallocate(cubmat)
      allocate(cubmat(nx,ny,nz))
      call walltime(iwalltime1)
      write(*,*) "Calculating electron density grid data..."
      !Because uniform grid cannot integrate well core density, so temporarily disable EDFs
      nEDFprims_org=nEDFprims
      nEDFprims=0
      call delvirorb(1) !Delete high-lying virtual orbitals for faster calculation
      call savecubmat(1,0,1)
      call delvirorb_back(1) !Restore to previous wavefunction
      nEDFprims=nEDFprims_org
   else !Directly using loaded electron density from cub/VASP grid data, and transforming grid data information to cell information
      if (all(a%charge==0)) then
         write(*,*) "Error: All nuclear charges are zero! If this file was exported by CP2K, it is a bug. You need to manually &
            edit the file so that effective nuclear charges (column 2 since line 8) are correctly recorded, otherwise atomic charges cannot be calculated"
         write(*,*) "Press ENTER button to return"
         read(*,*)
         return
      end if
      call grid2cellinfo
      call calc_dvol(dvol)
      !call showcellinfo
      call walltime(iwalltime1)
   end if

!Set initial sigma and population of various shells
   shpop(:,:)       = 0.0d0
   shalpha(:,:,:,:) = 0.0d0
!write(*,*) " Initial guess for EMBIS parameters?"
!write(*,*) "---------------------------------"
!write(*,*) "1) the default MBIS guess"
!write(*,*) "2) from an MBIS mpl file"
!read(*,*) intp
   if (initembis==0) then
!if (intp==1) then

      icore=1 !If consider core shells. If =0, initial population of core shells will be 0, and core shells will not be utilized during iteration (population and sigma will be zero throughout iterations)
      !For density only representing valence electrons, I found ignoring core shells do not improve convergence. After first several iterations, core population automatically decreases to nearly zero

      do iatm=1,ncenter
         iele = a(iatm)%index
         if (iele==0) then !Ghost atom, initialize as shsig=1 and with a tiny population. This scheme is defined by frj
!frj bug fix in the original code
!        mshell=0
!        shsig(1,iatm) = 1
!        shpop(1,iatm)=1D-3
! frj turn off ignorefar since atmrhocutsqr has no suitable value for ghost atoms
            ignorefar = 0
            mshell(iatm)=1
            shalpha(1,iatm,1,1)=1.0d0
            shalpha(1,iatm,2,2)=1.0d0
            shalpha(1,iatm,3,3)=1.0d0
            shalpha(1,iatm,1,2)=0.0d0
            shalpha(1,iatm,1,3)=0.0d0
            shalpha(1,iatm,2,1)=0.0d0
            shalpha(1,iatm,2,3)=0.0d0
            shalpha(1,iatm,3,1)=0.0d0
            shalpha(1,iatm,3,2)=0.0d0
            shpop(1,iatm)=1D-2
         else if (iele<=2) then
            mshell(iatm) = 1
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,2)=0.0d0
            shalpha(1,iatm,1,3)=0.0d0
            shalpha(1,iatm,2,1)=0.0d0
            shalpha(1,iatm,2,3)=0.0d0
            shalpha(1,iatm,3,1)=0.0d0
            shalpha(1,iatm,3,2)=0.0d0
            shpop(1,iatm)=iele
         else if (iele<=10) then
            mshell(iatm) = 2
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            shalpha(2,iatm,1,1) = (2.0d0)**2
            shalpha(2,iatm,2,2) = (2.0d0)**2
            shalpha(2,iatm,3,3) = (2.0d0)**2
            shalpha(2,iatm,1,3) = 0.0d0
            shalpha(2,iatm,1,2) = 0.0d0
            shalpha(2,iatm,2,3) = 0.0d0
            shalpha(2,iatm,2,1) = 0.0d0
            shalpha(2,iatm,3,2) = 0.0d0
            shalpha(2,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            shpop(2,iatm)=iele-2
         else if (iele<=18) then
            mshell(iatm) = 3
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2 !OBS
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            shalpha(2,iatm,1,1) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,2,2) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,3,3) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,1,3) = 0.0d0
            shalpha(2,iatm,1,2) = 0.0d0
            shalpha(2,iatm,2,3) = 0.0d0
            shalpha(2,iatm,2,1) = 0.0d0
            shalpha(2,iatm,3,2) = 0.0d0
            shalpha(2,iatm,3,1) = 0.0d0
            shalpha(3,iatm,1,1) = (2.0d0)**2
            shalpha(3,iatm,2,2) = (2.0d0)**2
            shalpha(3,iatm,3,3) = (2.0d0)**2
            shalpha(3,iatm,1,3) = 0.0d0
            shalpha(3,iatm,1,2) = 0.0d0
            shalpha(3,iatm,2,3) = 0.0d0
            shalpha(3,iatm,2,1) = 0.0d0
            shalpha(3,iatm,3,2) = 0.0d0
            shalpha(3,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            shpop(3,iatm)=iele-10
         else if (iele<=36) then
            mshell(iatm) = 4
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,3
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,3,3) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do

            shalpha(4,iatm,1,1) = (2.0d0)**2
            shalpha(4,iatm,2,2) = (2.0d0)**2
            shalpha(4,iatm,3,3) = (2.0d0)**2
            shalpha(4,iatm,1,3) = 0.0d0
            shalpha(4,iatm,1,2) = 0.0d0
            shalpha(4,iatm,2,3) = 0.0d0
            shalpha(4,iatm,2,1) = 0.0d0
            shalpha(4,iatm,3,2) = 0.0d0
            shalpha(4,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            shpop(4,iatm)=iele-18
         else if (iele<=54) then
            mshell(iatm) = 5
!       shalpha(1,iatm) = (2*iele)
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,4
               !        shalpha(ishell,iatm) = (2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,3,3) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do
!        shalpha(5,iatm) = 2
            shalpha(5,iatm,1,1) = (2.0d0)**2
            shalpha(5,iatm,2,2) = (2.0d0)**2
            shalpha(5,iatm,3,3) = (2.0d0)**2
            shalpha(5,iatm,1,3) = 0.0d0
            shalpha(5,iatm,1,2) = 0.0d0
            shalpha(5,iatm,2,3) = 0.0d0
            shalpha(5,iatm,2,1) = 0.0d0
            shalpha(5,iatm,3,2) = 0.0d0
            shalpha(5,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            if (icore==1) shpop(4,iatm)=18
            shpop(5,iatm)=iele-36
         else if (iele<=86) then
            mshell(iatm) = 6
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,5
               !        shalpha(ishell,iatm) = (2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do
!        shalpha(6,iatm) = 2
            shalpha(6,iatm,1,1) = (2.0d0)**2
            shalpha(6,iatm,2,2) = (2.0d0)**2
            shalpha(6,iatm,3,3) = (2.0d0)**2
            shalpha(6,iatm,1,3) = 0.0d0
            shalpha(6,iatm,1,2) = 0.0d0
            shalpha(6,iatm,2,3) = 0.0d0
            shalpha(6,iatm,2,1) = 0.0d0
            shalpha(6,iatm,3,2) = 0.0d0
            shalpha(6,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            if (icore==1) shpop(4,iatm)=18
            if (icore==1) shpop(5,iatm)=18
            shpop(6,iatm)=iele-54
         end if
      end do
!else if(intp==2) then
   else if(initembis==1) then
!       filename should already be read
      open(unit=10, file=filename, status='old', action='read')
      do
         read(10, '(A)',iostat=istatus) line
         if (istatus /= 0) then
            write(*,*) 'reached the end'
            stop
         end if
!        write(ifileid,'(a)')'  Atom  Number Shell   Npop           Sigma          Alpha'
!                if (index(line,"Atom Atom_nummer  Shell   Npop           Sigma         Alpha") > 0) then
         if (index(line,"Atom  Number Shell   Npop           Sigma          1/Sigma") > 0) then
            exit
         end if
      end do
      do
         read(10,*,iostat=istatus) navn, Nummer, skal,N, xs, xa
         !write(*,*) "DATA", skal, Nummer, xa
         shpop(skal,Nummer)=N
         mshell(Nummer)=skal
         shalpha(skal,Nummer,1,1) = xa**2 !xa is sigma^-1, thus we just square to get the diagonal components of the alpha matrix for EMBIS. The unit of alpha is Bohr^-2
         shalpha(skal,Nummer,2,2) = xa**2
         shalpha(skal,Nummer,3,3) = xa**2
         shalpha(skal,Nummer,1,2) = 0.0d0
         shalpha(skal,Nummer,2,1) = 0.0d0
         shalpha(skal,Nummer,1,3) = 0.0d0
         shalpha(skal,Nummer,3,1) = 0.0d0
         shalpha(skal,Nummer,2,3) = 0.0d0
         shalpha(skal,Nummer,3,2) = 0.0d0
         !write(*,*) "nr,skal,a11,n", Nummer,skal,shalpha(skal,Nummer,1,1), shpop(skal,Nummer)
         if (istatus/= 0) exit
      end do
      close(10)
   end if
   write(*,*)
   write(*,*) "Performing EMBIS iterations to refine atomic spaces..."
   lastcharge=0


! lmult turns on all multipole calculations when close to convergence
!       this saves ~10% computational time compared to calculating them in each MBIS iteration
   lmult=.false.

   do icyc=1,maxcyc
      if (ioutmedchg==1) write(*,*)
      if (icyc==1) then
         write(*,"(' Cycle',i5)") icyc
      else
         write(*,"(' Cycle',i5,'   Maximum change:',f12.8)") icyc,varmax
      end if

      !Monitor population and width of shells
      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpop(1:mshell(iatm),iatm))
      !end do
      !write(*,*) "Width (sigma) of each shell in Bohr"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm),ish=1,mshell(iatm))
      !end do

      shpopnew(:,:)=0 !New population of shells of various atoms
      shalphanew(:,:,:,:)=0
      shsignew(:,:,:,:)=0
      !shsignew(:,:,:,:)=0 !New sigma of shells of various atoms
!       frj initialization for shell multipoles
      shellchg = 0.0d0
      shelldip = 0.0d0
      shellquad = 0.0d0
      shelloct  = 0.0d0
      shellhex  = 0.0d0
      dsinfo = 0.0d0
!       frj initialization for atomic volumen and atom-atom bond order
      atomvolume = 0.0d0
      bondorder = 0.0d0
! frj
      if (imode==0) then !Using multicenter integration to evaluate population of various shells of various atoms based on present sigma (Eq. 18 of MBIS paper)
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            ! frj
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)     ! frj
            do ipt=1+iradcut*sphpot,ntotpot
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     alphaval11 = shalpha(ishell,jatm,1,1)
                     alphaval22 = shalpha(ishell,jatm,2,2)
                     alphaval33 = shalpha(ishell,jatm,3,3)
                     alphaval13 = shalpha(ishell,jatm,1,3)
                     alphaval12 = shalpha(ishell,jatm,1,2)
                     alphaval23 = shalpha(ishell,jatm,2,3)
                     alphaval31 = alphaval13
                     alphaval21 = alphaval12
                     alphaval32 = alphaval23
                     det=0.0d0
                     det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23

                     g=0.0d0
                     g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                     ! if (abs(g)>100000) cycle
                     tmp = shpop(ishell,jatm)*dsqrt(det)/8/pi*exp(-dsqrt(g)) !Eq. 7 of MBIS paper
                     if (tmp<dencut) tmp = 0 !I don't know why frj introduced this criterion. Seems that this can make insignificant grid ignored and reduce cost (because of wtot>0)?
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do
               !Accumulate contribution of this integration grid to new population and sigma of shells
               tmpden = tmpdens(ipt,iatm)
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     dx = gridatm(ipt)%x - a(jatm)%x
                     dy = gridatm(ipt)%y - a(jatm)%y
                     dz = gridatm(ipt)%z - a(jatm)%z
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis  = dsqrt(dis2)
                     dis3 = dis*dis2
                     dstmp  = 0.0d0          ! frj
                     do ishell=1,mshell(jatm)
                        alphaval11 = shalpha(ishell,jatm,1,1)
                        alphaval22 = shalpha(ishell,jatm,2,2)
                        alphaval33 = shalpha(ishell,jatm,3,3)
                        alphaval13 = shalpha(ishell,jatm,1,3)
                        alphaval12 = shalpha(ishell,jatm,1,2)
                        alphaval23 = shalpha(ishell,jatm,2,3)
                        alphaval31 = alphaval13
                        alphaval21 = alphaval12
                        alphaval32 = alphaval23

                        det = 0.0d0
                        det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23

                        g=0.0d0
                        g =alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz

                        shpopnew(ishell,jatm) = shpopnew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/rho0 !Eq. 18 of MBIS paper

                        !if (abs(dsqrt(g))<1.0d-8) cycle  ! HER ER FEJLEN!!!! I OBT 3

                        shsignew(ishell,jatm,1,1) = shsignew(ishell,jatm,1,1) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 19 of MBIS paper
                        shsignew(ishell,jatm,2,2) = shsignew(ishell,jatm,2,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,3,3) = shsignew(ishell,jatm,3,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dz*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,1,2) = shsignew(ishell,jatm,1,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,1,3) = shsignew(ishell,jatm,1,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,3) = shsignew(ishell,jatm,2,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,1) = shsignew(ishell,jatm,1,2)
                        shsignew(ishell,jatm,3,1) = shsignew(ishell,jatm,1,3)
                        shsignew(ishell,jatm,3,2) = shsignew(ishell,jatm,2,3)
!                                                       frj generate atomic multipoles and dSinfo
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/rho0
                        atomvolume(jatm) = atomvolume(jatm) + dis3*wtmp
                        shellchg(ishell,jatm) = shellchg(ishell,jatm) + wtmp
!                                                       frj: calculate multipoles only if close to convergence, this saves some time
                        if (lmult) call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,shelldip,shellquad,shelloct,shellhex)
! frj:                                                  accumulate bond order
                        do katm=1,ncenter
                           do kshell=1,mshell(katm)
                              wjtmp = rho0sh(ishell,jatm)/rho0
                              wktmp = rho0sh(kshell,katm)/rho0
                              bondorder(jatm,katm) = bondorder(jatm,katm) + wjtmp*wktmp*tmpden
!                                                                        write(*,"(4i5,3d15.4)")jatm,ishell,katm,kshell,wjtmp,wktmp,tmpden
                           enddo
                        enddo
                     end do
!                                               actual density: rho1
!                                               model density:  rho2
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo = dsinfo + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do

      else !Using evenly distributed grids
         ifinish=0
         ntmp=floor(ny*nz/100D0)
         !$OMP PARALLEL SHARED(shpopnew,shsignew,ifinish,ishowprog) PRIVATE(shpopnew_tmp,shsignew_tmp,i,j,k,rho0sh,rho0,tmpx,tmpy,tmpz,tvec, &
         !$OMP ic,jc,kc,icell,jcell,kcell,iatm,dx,dy,dz,dis,dis2,dis2min,ishell,sigval,tmp,tmp2,tmp3,tmpden,atmdis2min) NUM_THREADS(nthreads)
         shpopnew_tmp(:,:)=0
         shsignew_tmp(:,:,:,:)=0
         !$OMP DO schedule(dynamic) collapse(2)
         do k=1,nz
            do j=1,ny
               do i=1,nx
                  if (cubmat(i,j,k)<1D-10) cycle
                  rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
                  rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
                  call getgridxyz(i,j,k,tmpx,tmpy,tmpz)
                  !call getpointcell(tmpx,tmpy,tmpz,ic,jc,kc)
                  atmdis2min(:)=1D10
                  do icell=-PBCnx,+PBCnx
                     do jcell=-PBCny,+PBCny
                        do kcell=-PBCnz,+PBCnz
                           call tvec_PBC(icell,jcell,kcell,tvec)
                           do iatm=1,ncenter
                              dx=a(iatm)%x+tvec(1)-tmpx
                              dy=a(iatm)%y+tvec(2)-tmpy
                              dz=a(iatm)%z+tvec(3)-tmpz
                              dis2=dx*dx+dy*dy+dz*dz
                              if (dis2<atmdis2min(iatm)) atmdis2min(iatm)=dis2
                              if (dis2>atmrhocutsqr(a(iatm)%index)) cycle !Ignore atoms that do not contribute notably to present grid
                              dis=dsqrt(dis2)
                              do ishell=1,mshell(iatm)
                                 alphaval11 = shalpha(ishell,iatm,1,1)
                                 alphaval22 = shalpha(ishell,iatm,2,2)
                                 alphaval33 = shalpha(ishell,iatm,3,3)
                                 alphaval13 = shalpha(ishell,iatm,1,3)
                                 alphaval12 = shalpha(ishell,iatm,1,2)
                                 alphaval23 = shalpha(ishell,iatm,2,3)
                                 alphaval31 = alphaval13
                                 alphaval21 = alphaval12
                                 alphaval32 = alphaval23

                                 det=0
                                 det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23

                                 g=0
                                 g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz

                                 tmp = shpop(ishell,iatm)*dsqrt(det)/8/pi*exp(-dsqrt(g)) !Eq. 7 of MBIS paper
                                 rho0sh(ishell,iatm) =  tmp
                                 rho0 = rho0 + tmp
                              end do
                           end do
                        end do
                     end do
                  end do

                  !Accumulate contribution of this integration grid to new population and sigma of shells
                  tmpden = cubmat(i,j,k)*dvol
                  if (rho0>0.and.tmpden>eps) then
                     do iatm=1,ncenter
                        tmp2=tmpden/rho0
                        tmp3=tmp2*dsqrt(atmdis2min(iatm))
                        do ishell=1,mshell(iatm)
                           alphaval11 = shalpha(ishell,iatm,1,1)
                           alphaval22 = shalpha(ishell,iatm,2,2)
                           alphaval33 = shalpha(ishell,iatm,3,3)
                           alphaval13 = shalpha(ishell,iatm,1,3)
                           alphaval12 = shalpha(ishell,iatm,1,2)
                           alphaval23 = shalpha(ishell,iatm,2,3)

                           g=0
                           g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                           !write(*,*) "G=",g
                           if (abs(g)<1.0d-15) cycle
                           shpopnew_tmp(ishell,iatm) = shpopnew(ishell,iatm) + tmpden*rho0sh(ishell,iatm)/rho0 !Eq. 18 of MBIS paper

                           shsignew_tmp(ishell,iatm,1,1) = shsignew(ishell,iatm,1,1) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 19 of MBIS paper
                           shsignew_tmp(ishell,iatm,2,2) = shsignew(ishell,iatm,2,2) + tmpden*rho0sh(ishell,iatm)/rho0*(dy*dy)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,3,3) = shsignew(ishell,iatm,3,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dz*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,1,2) = shsignew(ishell,iatm,1,2) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dy)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,1,3) = shsignew(ishell,iatm,1,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,2,3) = shsignew(ishell,iatm,2,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dy*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,2,1) = shsignew_tmp(ishell,iatm,1,2)
                           shsignew_tmp(ishell,iatm,3,1) = shsignew_tmp(ishell,iatm,1,3)
                           shsignew_tmp(ishell,iatm,3,2) = shsignew_tmp(ishell,iatm,2,3)



                        end do
                     end do
                  end if
               end do
               !$OMP CRITICAL
               ifinish=ifinish+1
               ishowprog=mod(ifinish,ntmp)
               if (ishowprog==0) call showprog(floor(100D0*ifinish/(ny*nz)),100)
               !$OMP END CRITICAL
            end do
         end do
         !$OMP END DO
         !$OMP CRITICAL
         shpopnew(:,:)=shpopnew(:,:)+shpopnew_tmp(:,:)
         shsignew(:,:,:,:)=shsignew(:,:,:,:)+shsignew_tmp(:,:,:,:)
         !$OMP END CRITICAL
         !$OMP END PARALLEL
         if (ishowprog/=0) call showprog(100,100)
      end if

      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpopnew(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpopnew(1:mshell(iatm),iatm))
      !end do
!	write(*,*) "Width (sigma) of each shell in Bohr"
!	do iatm=1,ncenter
!		write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shalpha(ish,iatm,1,1),ish=1,mshell(iatm))
!	end do
      !   write(*,*) "--------------------------"

      !Include prefix part of Eq. 19 of MBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            alphaval11 = shsignew(ish,iatm,1,1)
            alphaval22 = shsignew(ish,iatm,2,2)
            alphaval33 = shsignew(ish,iatm,3,3)
            alphaval13 = shsignew(ish,iatm,1,3)
            alphaval12 = shsignew(ish,iatm,1,2)
            alphaval23 = shsignew(ish,iatm,2,3)

            det =0
            det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
            !  write(*,*) "det=", det

            if (abs(det)<1.0d-14) cycle



            shalphanew(ish,iatm,1,1)=1.0d0/det * (shsignew(ish,iatm,2,2)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,2,3)*shsignew(ish,iatm,2,3))
            shalphanew(ish,iatm,2,2)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,3))
            shalphanew(ish,iatm,3,3)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,2)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,2,1))
            shalphanew(ish,iatm,1,2)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,3,3) )
            shalphanew(ish,iatm,1,3)=1.0d0/det * (shsignew(ish,iatm,1,2)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,2) )
            shalphanew(ish,iatm,2,3)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,2)-shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,3) )
            shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,1,3)
            shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)
            shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,1,2)

            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,1)=shalphanew(ish,iatm,1,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,2)=shalphanew(ish,iatm,2,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,3)=shalphanew(ish,iatm,3,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,2)=shalphanew(ish,iatm,1,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,3)=shalphanew(ish,iatm,1,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,3)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,2,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,3,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))
         end do
      end do

      !Summing up shell populations to atomic population and get atomic charge
      do iatm=1,ncenter
         tmppop=sum(shpopnew(1:mshell(iatm),iatm)) !Atomic population
         if (nEDFelec==0.or.imode>0) then !Note that EDFs were not involved in evaluating system density when using even grids (imode>0)
            charge(iatm) = a(iatm)%charge - tmppop
         else !EDF is used for some atoms. Core electron density represented by EDF has been integrated, so nuclear charge should be augmented by nEDFelecatm
            charge(iatm) = a(iatm)%charge+nEDFelecatm(iatm) - tmppop
         end if
         if (ioutmedchg==1) write(*,"(i5,'(',a,')   charge:',f12.6)") iatm,a(iatm)%name,charge(iatm)
      end do


!Check convergence, choice between converging on charges (sum of shell-populations) or shell-alpha (exponents)
      varmax=maxval(abs(charge(:)-lastcharge(:)))
      varsig=maxval(abs(shalphanew(:,:,:,:)-shalpha(:,:,:,:)))
!       frj: turn on multipole calculation if approaching convergence
      if (varmax<10.0d0*crit .and. ishellconv==0) lmult=.true.
      if (varsig<10.0d0*crit .and. ishellconv==1) lmult=.true.
!       be careful if tight convergence has been requested
      if (varmax<1.0d-4 .and. ishellconv==0) lmult=.true.
      if (varsig<1.0d-4 .and. ishellconv==1) lmult=.true.
!
!frj : orginal code
!	if (varmax<crit.or.icyc==maxcyc) then
!                if (varmax<crit) write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
!                if (icyc==maxcyc) write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
!		exit
!	end if
!frj : new code, introducing convergence on shsig
      if (icyc==maxcyc) then
         write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
         exit
      end if
      if (varmax<crit .and. ishellconv==0) then
         write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
         exit
      end if
      if (varsig<crit .and. ishellconv==1) then
         write(*,"(/,a,f10.6)") " All atomic shell alphas have converged to criterion of",crit
         exit
      end if

      !Update atomic charges, shell population and sigma
      lastcharge(:)=charge(:)
      shpop(:,:)=shpopnew(:,:)
      shalpha(:,:,:,:)=shalphanew(:,:,:,:)
   end do

   write(*,"(' Sum of all raw charges:',f14.8)") sum(charge(:))
!Normalize atomic charges. This is not feasible if only grid data is available, &
!because in this case the nelec used in "normalize_atmchg" is simply guessed by assuming system is neutral
   if (imode==1) call normalize_atmchg(charge(:))
!Print final atomic charges
   call printatmchg(charge(:))

   write(*,*)' '
   write(*,*)' Atomic volumes, defined as Int(r^3*rho), in au'
   do iatm=1,ncenter
      write(*,"(i5,f12.6)")iatm,atomvolume(iatm)
   enddo
   write(*,*)' '
   write(*,*)' Bond order matrix, only values larger than 0.05 are printed'
   do iatm=1,ncenter-1
      do jatm=iatm+1,ncenter
         tmp = bondorder(iatm,jatm)
         if (tmp.gt.0.05d0) write(*,"(2i5,f12.4)")iatm,jatm,tmp
!                write(*,*)iatm,jatm,tmp
      enddo
   enddo


   if (allocated(frag1)) then
      write(*,"(/,' Fragment charge:',f14.8)") sum(charge(frag1))
      write(*,"(' Fragment population:',f14.8)") sum(a(frag1)%charge) - sum(charge(frag1))
   end if

   if (ioutshell==1) then
      write(*,*)
      write(*,*) "Population of each shell"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,mshell(iatm))
      end do
      write(*,*)
      write(*,*) "Width (sigma) of each shell in Bohr"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm,1,1),ish=1,mshell(iatm))
      end do
!frj
      write(*,*) "Alpha of each shell in Bohr-1"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(1.0d0/shsig(ish,iatm,1,1),ish=1,mshell(iatm))
      end do
!frj
   end if

   call walltime(iwalltime2)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime2-iwalltime1

   if (itype==1) then !Output charges
      call outatmchg(10,charge(:))
   else if (itype==2) then !Generate radial density of every atom
      if (allocated(atmradnpt)) deallocate(atmradnpt)
      if (allocated(atmraddens)) deallocate(atmraddens)
      allocate(atmradnpt(ncenter),atmraddens(200,ncenter))
      do iatm=1,ncenter
         do ipt=1,200
            tmprho=0
            do ishell=1,mshell(iatm)
               alphaval11 = shalpha(ishell,iatm,1,1)
               alphaval22 = shalpha(ishell,iatm,2,2)
               alphaval33 = shalpha(ishell,iatm,3,3)
               alphaval13 = shalpha(ishell,iatm,1,3)
               alphaval12 = shalpha(ishell,iatm,1,2)
               alphaval23 = shalpha(ishell,iatm,2,3)
               alphaval31 = alphaval13
               alphaval21 = alphaval12
               alphaval32 = alphaval23
               det =0
               det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
               g=0
               g =alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
               shpopnew(ishell,iatm) = shpopnew(ishell,iatm) + tmpden*rho0sh(ishell,iatm)/rho0 !Eq. 18 of MBIS paper
               tmprho = tmprho +  shpop(ishell,iatm)*(dsqrt(det))/(8*pi)*exp(-dsqrt(g))
            end do
            atmraddens(ipt,iatm)=tmprho
            if (tmprho<1D-8) then !Electron density truncation
               atmradnpt(iatm)=ipt
               exit
            end if
         end do
      end do
      write(*,*) "Construction of MBIS atomic spaces has been finished!"
   end if

!frj generate exact results for printing and for later possible constrained MBIS
   !call calc_multipole_frj(.false.,moldipol,molquad,moloct,molhex)
! calculate traceless form for printing purposes
!       Stone/Buckingham style traceless
   molquadt = 3.0d0*molquad
   trace = molquad(1) + molquad(4) + molquad(6)
   molquadt(1) = molquadt(1) - trace
   molquadt(4) = molquadt(4) - trace
   molquadt(6) = molquadt(6) - trace
   molquadt = molquadt/2.0d0

   moloctt  = 5.0d0*moloct
   tracex = moloct(1) + moloct(4) + moloct(6)
   tracey = moloct(2) + moloct(7) + moloct(9)
   tracez = moloct(3) + moloct(8) + moloct(10)
   moloctt(1)  = moloctt(1)  - 3.0d0*tracex
   moloctt(2)  = moloctt(2)  - tracey
   moloctt(3)  = moloctt(3)  - tracez
   moloctt(4)  = moloctt(4)  - tracex
   moloctt(6)  = moloctt(6)  - tracex
   moloctt(7)  = moloctt(7)  - 3.0d0*tracey
   moloctt(8)  = moloctt(8)  - tracez
   moloctt(9)  = moloctt(9)  - tracey
   moloctt(10) = moloctt(10) - 3.0d0*tracez
   moloctt  = moloctt/2.0d0

   molhext = 35.0d0*molhex
   trace   = molhex(1) + molhex(11) + molhex(15)
   trace   = trace + 2.0d0*( molhex(4) + molhex(6) + molhex(13) )
   tracexx = molhex(1) + molhex(4)  + molhex(6)
   tracexy = molhex(2) + molhex(7)  + molhex(9)
   tracexz = molhex(3) + molhex(8)  + molhex(10)
   traceyy = molhex(4) + molhex(11) + molhex(13)
   traceyz = molhex(5) + molhex(12) + molhex(14)
   tracezz = molhex(6) + molhex(13) + molhex(15)
   molhext(1)  = molhext(1)  - 30.0d0*tracexx + 3.0d0*trace
   molhext(2)  = molhext(2)  - 15.0d0*tracexy
   molhext(3)  = molhext(3)  - 15.0d0*tracexz
   molhext(4)  = molhext(4)  -  5.0d0*(tracexx + traceyy) + trace
   molhext(5)  = molhext(5)  -  5.0d0*traceyz
   molhext(6)  = molhext(6)  -  5.0d0*(tracexx + tracezz) + trace
   molhext(7)  = molhext(7)  - 15.0d0*tracexy
   molhext(8)  = molhext(8)  -  5.0d0*tracexz
   molhext(9)  = molhext(9)  -  5.0d0*tracexy
   molhext(10) = molhext(10) - 15.0d0*tracexz
   molhext(11) = molhext(11) - 30.0d0*traceyy + 3.0d0*trace
   molhext(12) = molhext(12) - 15.0d0*traceyz
   molhext(13) = molhext(13) -  5.0d0*(traceyy + tracezz) + trace
   molhext(14) = molhext(14) - 15.0d0*traceyz
   molhext(15) = molhext(15) - 30.0d0*tracezz + 3.0d0*trace
   molhext = molhext/8.0d0

   write(*,*)
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo
   write(*,*)' '
   write(*,*)' MBIS multipole moments up to rank 4'
   write(*,*)' '
! frj condense to atomic and molecular quantities
   call condensempl(.true.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
! frj and possibly write to file
   call eoutatommpl(10,2,maxshell,mshell(:),shpop(:,:),shalpha(:,:,:,:),shbeta,shbeta_rot,achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:),dsinfo)


! frj proceed to determine constrained MBIS?
   write(*,*)' '
   write(*,"(a)") " Proceed to decompose with multipole constraints?"
   write(*,"(a)") "  0: No"
   write(*,"(a)") " 10: Constrain Molecular Dipole                                               by Atomic Charges"
   write(*,"(a)") " 20: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges"
   write(*,"(a)") " 21: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges, Dipoles"
   write(*,"(a)") " 30: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges"
   write(*,"(a)") " 31: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles"
   write(*,"(a)") " 32: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 40: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges"
   write(*,"(a)") " 41: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles"
   write(*,"(a)") " 42: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 43: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles, Octupoles"
   read(*,*) itmp
   if (itmp.ne.10 .and. itmp.ne.20 .and. itmp.ne.21 .and. itmp.ne.30 .and. itmp.ne.31 .and. itmp.ne.32 .and. itmp.ne.40 .and.  itmp.ne.41 .and. itmp.ne.42 .and. itmp.ne.43) return
   lcdip=.false.
   lcquad=.false.
   ldquad=.false.
   lcoct=.false.
   ldoct=.false.
   lqoct=.false.
   lchex=.false.
   ldhex=.false.
   lqhex=.false.
   lohex=.false.

   if (itmp.eq.10 .or. itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)         lcdip  = .true.
   if (itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)                         lcquad = .true.
   if (itmp.eq.30 .or. itmp.eq.40)                                         lcoct  = .true.
   if (itmp.eq.40)                                                         lchex  = .true.

   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcdip  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         lcoct  = .true.
   if (itmp.eq.41)                                                         lchex  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         ldquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         ldoct  = .true.
   if (itmp.eq.41)                                                         ldhex  = .true.

   if (itmp.eq.32 .or. itmp.eq.42)                                         lcdip  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcoct  = .true.
   if (itmp.eq.42)                                                         lchex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldoct  = .true.
   if (itmp.eq.42)                                                         ldhex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lqoct  = .true.
   if (itmp.eq.42)                                                         lqhex  = .true.

   if (itmp.eq.43)                                                         lcdip  = .true.
   if (itmp.eq.43)                                                         lcquad = .true.
   if (itmp.eq.43)                                                         lcoct  = .true.
   if (itmp.eq.43)                                                         lchex  = .true.
   if (itmp.eq.43)                                                         ldquad = .true.
   if (itmp.eq.43)                                                         ldoct  = .true.
   if (itmp.eq.43)                                                         ldhex  = .true.
   if (itmp.eq.43)                                                         lqoct  = .true.
   if (itmp.eq.43)                                                         lqhex  = .true.
   if (itmp.eq.43)                                                         lohex  = .true.

! determine effective dimension of constraints, this actually saves some time
   ndimcon = 0
   if (lcdip) ndimcon = ndimcon + 3
   if (lcquad .or. ldquad) ndimcon = ndimcon + 6
   if (lcoct .or. ldoct .or. lqoct) ndimcon = ndimcon + 10
   if (lchex .or. ldhex .or. lqhex .or. lohex) ndimcon = ndimcon + 15
!write(*,*)'ndimcon =',ndimcon

   write(*,"(a,3f9.4)")'Reference molecular dipole      ',(moldipol(i),i=1,3)
   write(*,"(a,6f9.4)")'Reference traceless quadrupole  ',(molquadt(i),i=1,6)
   write(*,"(a,10f9.3)")'Reference traceless octupole    ',(moloctt(i),i=1,10)
   write(*,"(a,15f9.2)")'Reference traceless hexadecapole',(molhext(i),i=1,15)
   write(*,*)' '

! determine number of constraints and warn the user of some likely constraint failures
! charge is always conserved:
   nconstr = 1
   if (lcdip) nconstr = nconstr + 3
   if (lcquad .or. ldquad) nconstr = nconstr + 5
   if (lcoct .or. ldoct .or. lqoct) nconstr = nconstr + 7
   if (lchex .or. ldhex .or. lqhex .or. lohex) nconstr = nconstr + 9
   nparam = ncenter
   if (ldquad .or. ldoct .or. ldhex) nparam = nparam + 3*ncenter
   if (lqoct .or. lqhex) nparam = nparam + 5*ncenter
   if (lohex) nparam = nparam + 7*ncenter
   write(*,"(a,i5)")' Number of constraints       = ',nconstr
   write(*,"(a,i5)")' Number of atomic parameters = ',nparam
   if (nconstr .gt. nparam) write(*,"(a)")' WARNING! More constraints than free atomic parameters!'

! for testing, the exact dipole and quadrupole can be replaced with the reconstructed, as this makes the atomic to molecular multipole contribution zero to within the numerical noise
!do i=1,3
!   moldipol(i)=mdip(i,3)
!enddo
!do i=1,6
!   molquad(i)=mquad(i,4)
!   molquadt(i)=mquadt(i,4)
!enddo
!write(*,"(a,3f15.8)")'Reconstru molecular dipole     moments',(moldipol(i),i=1,3)
!write(*,"(a,6f15.8)")'Reconstru molecular quadrupole moments',(molquad(i),i=1,6)
!write(*,"(a,6f15.8)")'Reconstru traceless quadrupole moments',(molquadt(i),i=1,6)

! frj   this version calculates the new NAi and sigmaAi parameters in each kappa iteration, but they are only used if the kappa iterations has converged
!       this avoids the construction of a separate grid integration for these parameters, when the kappa iterations has converged
!       thus, a slight increase in the computational cost for each kappa iteration, but saving a grid integration for updating NAi and sigmaAi
!       the computational cost appears slightly larger, but the code is cleaner
!
! reuse maxcyc as safeguard for parameter iteration, this should (hopefully) be an overestimate
! set a small number of fixed number of kappa iterations (10), this should converge fast
!       if not, it is probably better to update the MBIS parameters, rather than spend more time on converging the constraints
!       one could consider always only doing one kappa iteration before parameter update, but that requires change in the code logic to detect proper convergence
!       currently a couple of other criteria are used for deciding whether to abandon the kappa iteration in favor of MBIS update (see later)
! set convergence criteria for the atomic charges to be the user specified in the regular MBIS
! set the gkappa convergence to factor 2 lower, and introduce a maximum kappa step, smax, as a safeguard
   kappamax=10
   qconv = crit
   gconv = 0.5d0*crit
   smax  = 1.0d-1

! initialize the Lagrange multiplier as zero
   kappa = 0.0d0
! for testing numerical vs. analytical Jacobian, test non-zero kappa values
!kappa = 0.001d0

! initialize the old charges as the regular MBIS
   achgold=achg(1,:)

! initialize the q (charge) history, for deciding if the decomposition fails, likely due to insufficient grid
   qhist=0.0d0

! lmult turns on all multipole calculations when close to convergence, otherwise only the necessary are calculated
! lpmult monitors lmult from the previous macro iteration, an ugly hack to prevent multipoles not being calculated in some rare cases
   lmult=.false.
   lpmult=.false.

! the outer loop for updating the MBIS parameters when kappa has been updated to make the constraints zero
! for testing numerical vs. analytical Jacobian, only one iteration
   if (lnumjacobi) maxcyc=1
   do kpar=1,maxcyc
      lpmult=lmult

! initialize the gkappa history, for deciding if the constraints fail, likely due to insufficient grid
      ghist=0.0d0

! the inner loop for iterating kappa to fulfill the multipole constraints
! for testing numerical vs. analytical Jacobian, only one iteration, and assign numerical stepsize
      if (lnumjacobi) then
         kappamax=1
         gstep=1.0d-4!OBS RETTER FOR TESTING
         gtmp=0.0d0
      endif
      do ikappa=1,kappamax

! lnumjacobi: turn next 5 lines on for testing numerical vs. analytical Jacobian, this must be done manually
!do knum=0,ndimcon
!  do kkk=1,2
!    if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)-gstep
!    if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)+gstep
!    write(*,*)'progress',knum,kkk


! initiate the Jacobian
         jkappa = 0.0d0

! frj re-use code structure from the above MBIS iteration to calculate cMBIS
         shellchg  = 0.0d0
         shelldip  = 0.0d0
         shellquad = 0.0d0
         shelloct  = 0.0d0
         shellhex  = 0.0d0
         dsinfo    = 0.0d0
         shpopnew(:,:)=0 !New population of shells of various atoms
         shsignew(:,:,:,:)=0 !New sigma of shells of various atoms
         shalphanew(:,:,:,:)=0
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
            do ipt=1+iradcut*sphpot,ntotpot
               gx = gridatm(ipt)%x
               gy = gridatm(ipt)%y
               gz = gridatm(ipt)%z
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     alphaval11 = shalpha(ishell,jatm,1,1)
                     alphaval22 = shalpha(ishell,jatm,2,2)
                     alphaval33 = shalpha(ishell,jatm,3,3)
                     alphaval13 = shalpha(ishell,jatm,1,3)
                     alphaval12 = shalpha(ishell,jatm,1,2)
                     alphaval23 = shalpha(ishell,jatm,2,3)
                     alphaval31 = alphaval13
                     alphaval21 = alphaval12
                     alphaval32 = alphaval23
                     det =0.0d0
                     det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
                     g=0.0d0
                     g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                     if (abs(g)>100000) cycle

                     tmp = shpop(ishell,jatm)*dsqrt(det)/8/pi*exp(-dsqrt(g)) !Eq. 7 of MBIS paper
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do

!               frj: construct the equivalent of rho0 for the re-weighting, this is the denominator for the atomic shell weights collected in wtatm
               wtatm=0.0d0
!               frj: the wa derivatives for the Jacobian collected in jtatm, first collect the numerator in the wa term
               jtatm=0.0d0
!               katm loop over all atoms A and constructs the nominator for the re-weighting
               do katm=1,ncenter
                  rxk = a(katm)%x
                  ryk = a(katm)%y
                  rzk = a(katm)%z
                  dgkx = gx - rxk
                  dgky = gy - ryk
                  dgkz = gz - rzk
!                       calculate the multipole geometry functions for atom katm
                  call makehfunc(rxk,ryk,rzk,dgkx,dgky,dgkz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hkfunc)

                  do kshell=1,mshell(katm)
                     wtmp = 0.0d0
!                               jatm loop to collect the contribtions from all the other atoms in terms of distance
                     do jatm=1,ncenter
                        rxj = a(jatm)%x
                        ryj = a(jatm)%y
                        rzj = a(jatm)%z
                        dgjx = gx - rxj
                        dgjy = gy - ryj
                        dgjz = gz - rzj
!                                       calculate the multipole geometry functions for atom jatm
                        call makehfunc(rxj,ryj,rzj,dgjx,dgjy,dgjz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hjfunc)
!                                       charge-dipole term
                        dtmp = 0.0d0
                        if (lcdip) then
                           do i=1,3
                              dtmp = dtmp + kappa(i)*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                           enddo
                        end if
!                                       charge-quadrupole term
                        qtmp = 0.0d0
                        if (lcquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                           enddo
                        end if
!                                       dipole-quadrupole term
                        if (ldquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                           enddo
                        end if
!                                       charge-octupole term
                        otmp = 0.0d0
                        if (lcoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                           enddo
                        end if
!                                       dipole-octupole term
                        if (ldoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                           enddo
                        end if
!                                       quadrupole-octupole term
                        if (lqoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                           enddo
                        end if
!                                       charge-hexadecapole term
                        htmp = 0.0d0
                        if (lchex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                           enddo
                        end if
!                                       dipole-hexadecapole term
                        if (ldhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                           enddo
                        end if
!                                       quadrupole-hexadecapole term
                        if (lqhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                           enddo
                        end if
!                                       octupole-hexadecapole term
                        if (lohex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                           enddo
                        end if
                        xtmp = exp(dtmp+qtmp+otmp+htmp)
                        do ishell=1,mshell(jatm)
                           tmp = rho0sh(ishell,jatm)
                           wtmp = wtmp + xtmp*tmp
                           if (jatm.ne.katm) then
!                                                   charge-dipole term
                              if (lcdip) then
                                 do i=1,3
                                    jtatm(i,kshell,katm) = jtatm(i,kshell,katm) + xtmp*tmp*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                                 enddo
                              end if
!                                                   charge-quadrupole term
                              if (lcquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                                 enddo
                              end if
!                                                   dipole-quadrupole term
                              if (ldquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                                 enddo
                              end if
!                                                   charge-octupole term
                              if (lcoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                                 enddo
                              end if
!                                                   dipole-octupole term
                              if (ldoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                                 enddo
                              end if
!                                                   quadrupole-octupole term
                              if (lqoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                                 enddo
                              end if
!                                                   charge-hexdecapole term
                              if (lchex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                                 enddo
                              end if
!                                                   dipole-hexdecapole term
                              if (ldhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                                 enddo
                              end if
!                                                   quadrupole-hexdecapole term
                              if (lqhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                                 enddo
                              end if
!                                                   octupole-hexdecapole term
                              if (lohex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                                 enddo
                              end if
                           end if
                        end do
                     end do
!                               denominator complete
                     wtatm(kshell,katm) = wtmp
!                               now complete the wa derivatives, note the minus sign
                     rtmp = rho0sh(kshell,katm)
!                               wtmp should always be close to 1, but safeguarding anyway....
                     if (wtmp.gt.eps) then
                        do i=1,ndimcon
                           jtatm(i,kshell,katm) = -jtatm(i,kshell,katm)*rtmp/(wtmp**2)
                        end do
                     end if
                  end do
               end do
!               jtatm now has the dwa/dkappa derivative

!               Accumulate contribution of this integration grid to density contribution
!               calculate the shell atomic multipole moments to be used for the g-functions
               tmpden = tmpdens(ipt,iatm)
!               keep rho0 as the deciding cutoff factor, this should be safe
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     gx = gridatm(ipt)%x
                     gy = gridatm(ipt)%y
                     gz = gridatm(ipt)%z
                     rx = a(jatm)%x
                     ry = a(jatm)%y
                     rz = a(jatm)%z
                     dx = gx-rx
                     dy = gy-ry
                     dz = gz-rz
!                               calculate multipole geometry functions
                     call makehfunc(rx,ry,rz,dx,dy,dz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hhfunc)
!
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis=dsqrt(dis2)
                     dstmp  = 0.0d0
                     do ishell=1,mshell(jatm)
                        shpopnew(ishell,jatm) = shpopnew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm) !Eq. 18 of MBIS paper

                        alphaval11 = shalpha(ishell,jatm,1,1)
                        alphaval22 = shalpha(ishell,jatm,2,2)
                        alphaval33 = shalpha(ishell,jatm,3,3)
                        alphaval13 = shalpha(ishell,jatm,1,3)
                        alphaval12 = shalpha(ishell,jatm,1,2)
                        alphaval23 = shalpha(ishell,jatm,2,3)

                        g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz

                        if(abs(dsqrt(g))<1.0d-8) cycle

                        shsignew(ishell,jatm,1,1) = shsignew(ishell,jatm,1,1) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 19 of MBIS paper
                        shsignew(ishell,jatm,2,2) = shsignew(ishell,jatm,2,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,3,3) = shsignew(ishell,jatm,3,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dz*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,1,2) = shsignew(ishell,jatm,1,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,1,3) = shsignew(ishell,jatm,1,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,3) = shsignew(ishell,jatm,2,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,1) = shsignew(ishell,jatm,1,2)
                        shsignew(ishell,jatm,3,1) = shsignew(ishell,jatm,1,3)
                        shsignew(ishell,jatm,3,2) = shsignew(ishell,jatm,2,3)
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm)
                        shellchg(ishell,jatm) = shellchg(ishell,jatm) + wtmp
! frj: lmult only calculates the necessary multipoles, except when close to convergence
                        call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,shelldip,shellquad,shelloct,shellhex)

!                                       the Jacobian, the h function to be multiplied with the dwa/dkappa derivative
                        do i=1,ndimcon
                           rr = 0.0d0
!                                          charge-dipole term
                           if (lcdip) then
                              if (i.ge.1 .and. i.le.3) rr = rr + hhfunc(1,1,i)
                           end if
!                                          charge-quadrupole term
                           if (lcquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(1,2,i-3)
                           end if
!                                          dipole-quadrupole term
                           if (ldquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(2,2,i-3)
                           end if
!                                          charge-octupole term
                           if (lcoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(1,3,i-9)
                           end if
!                                          dipole-octupole term
                           if (ldoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(2,3,i-9)
                           end if
!                                          quadrupole-octupole term
                           if (lqoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(3,3,i-9)
                           end if
!                                          charge-hexdecapole term
                           if (lchex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(1,4,i-19)
                           end if
!                                          dipole-hexdecapole term
                           if (ldhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(2,4,i-19)
                           end if
!                                          quadrupole-hexdecapole term
                           if (lqhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(3,4,i-19)
                           end if
!                                          octupole-hexdecapole term
                           if (lohex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(4,4,i-19)
                           end if
                           do j=1,ndimcon
                              jkappa(i,j) = jkappa(i,j) + rr*jtatm(j,ishell,jatm)*tmpden
                           end do
                        end do
                     end do
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo = dsinfo + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do
!write(*,*)' dSInfo = ',dsinfo

!frj condense shell contributions to atomic and molecular quantities
         call condensempl(.false.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
!
         if (kpar.eq.1 .and. ikappa.eq.1 .and. .not.lnumjacobi) then
            write(*,"(a,f12.6)")' Atomic charge        convergence = ',qconv
            write(*,"(a,f12.6)")' Multipole constraint convergence = ',gconv
            write(*,"(a,f12.6)")' Kappa step max                   = ',smax
            write(*,*)' '
            write(*,"(a)")'  MBIS kappa   gnorm       dCmax'
         end if
!frj calculate the g-functions: the errors in the multipole components
!       the error is relative to the sum of atomic multipoles included
!       test for convergence
         lgconv=.true.
         g1norm = 0.0d0
         g2norm = 0.0d0
         g3norm = 0.0d0
         g4norm = 0.0d0
         gkappa = 0.0d0
         if (lcdip) then
            do i=1,3
               tmp = moldipol(i) - mdip(i,1)
               gkappa(i) = tmp
               g1norm = g1norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcquad .or. ldquad) then
            do i=1,6
               if (ldquad) then
                  tmp = molquadt(i) - (mquadt(i,1) + mquadt(i,2))
               else
                  tmp = molquadt(i) - (mquadt(i,1))
               end if
               gkappa(i+3) = tmp
               g2norm = g2norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcoct .or. ldoct .or. lqoct) then
            do i=1,10
               if (lqoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2) + moctt(i,3))
               else if (ldoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2))
               else if (lcoct) then
                  tmp = moloctt(i) - (moctt(i,1))
               end if
               gkappa(i+9) = tmp
               g3norm = g3norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lchex .or. ldhex .or. lqhex .or. lohex) then
            do i=1,15
               if (lohex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3) + mhext(i,4))
               else if (lqhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3))
               else if (ldhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2))
               else if (lchex) then
                  tmp = molhext(i) - (mhext(i,1))
               end if
               gkappa(i+19) = tmp
               g4norm = g4norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         g1norm = g1norm/3.0d0
         g2norm = g2norm/6.0d0
         g3norm = g3norm/10.0d0
         g4norm = g4norm/15.0d0

! the next section turned for testing numerical vs. analytical Jacobian
         if (lnumjacobi) then
            if (knum.gt.0) then
               do j=1,ndimcon
                  gtmp(kkk,knum,j)=gkappa(j)
               enddo
            endif
            if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)+gstep
            if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)-gstep
            if (knum.eq.0 .and. kkk.eq.1) then
               jsave=jkappa
               write(*,*)'jkappa anal'
               do i=1,ndimcon
                  write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
               enddo
            endif
         endif

! lnumjacobi: turn on the next two lines that closes the numerical loop, must be turned on manually
!  enddo
!enddo

         if (lnumjacobi) then
            write(*,*)'jkappa num'
            do i=1,ndimcon
               do j=1,ndimcon
                  xxx(j,i)=(gtmp(2,i,j)-gtmp(1,i,j))/(2.0d0*gstep)
               enddo
            enddo
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,(xxx(i,j),j=1,ndimcon)
            enddo
            write(*,*)'jkappa anal-num'
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,((jsave(i,j)-xxx(i,j)),j=1,ndimcon)
            enddo
            itmp = 0
            jtmp = 0
            tmpm = 0.0d0
            itmpa = 0
            jtmpa = 0
            tmpma = 0.0d0
            do i=1,ndimcon
               do j=1,ndimcon
                  tmp = abs(jsave(i,j)-xxx(i,j))
                  if (tmp.gt.tmpm) then
                     itmp=i
                     jtmp=j
                     tmpm=tmp
                  endif
                  tmp = abs(jsave(i,j)-jsave(j,i))
                  if (tmp.gt.tmpma) then
                     itmpa=i
                     jtmpa=j
                     tmpma=tmp
                  endif
               enddo
            enddo
            write(*,*)'max diff =',tmpm,itmp,jtmp
            write(*,*)'max asym =',tmpma,itmpa,jtmpa
         endif
!end num Jacobian


! max change in atomic charges for printing
         dCmax=maxval(abs(achg(1,:)-achgold(:)))

! print info in the current MBIS-kappa iteration
         if (lcdip                                 ) write(*,"(2i5,2f12.6,5x,a,15f12.6)")kpar,ikappa,g1norm,dCmax,'kappa dip :',(kappa(i),i=1,3)
         if (lcquad .or. ldquad                    ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g2norm,'kappa quad:',(kappa(i),i=4,9)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g3norm,'kappa oct :',(kappa(i),i=10,15)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(74x,15f12.6)")(kappa(i),i=16,19)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g4norm,'kappa hex :',(kappa(i),i=20,27)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(62x,15f12.6)")(kappa(i),i=28,34)

         if (lgconv) then
!   write(*,"(a,f12.6)")' All multipole constraints converged to within',gconv
            goto 900
         endif

! solve for the next kappa
! this, in principle, could be done by a call to pseudoinverse, but this employs a fixed 10^-10 criteria for small being zero,
!       and grid noise may lead to zero singular values being larger than that.
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
!enddo

         call SVDmat(1,jkappa,umat,vmat,sigma,info)
         if (info.ne.0) then
            write(*,*)'WARNING! SVD of Jacobian failed'
         endif
!write(*,"(a,34d15.4)")'SVD sigma',(sigma(j),j=1,ndimcon)

! in the absence of symmetry there should be nconstraint-1 (charge conservation is always in place) non-zero eigenvalues,
!       but some of the rest could be non-zero due to grid noise from the traceless conditions, and some of the non-zero could be zero due to symmetry
! use a conservative svdcut criteria for deciding when small is zero, and make sure the gap position is valid...
         svdcut=1.0d-3
         ntmp=0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) ntmp=ntmp+1
         enddo
! if only dipole constraint, then there should be no a priori zero eigenvalues, and thus ntmp = ndimcon
         if (ntmp.lt.ndimcon) then
            tmp1 = sigma(ntmp)
            tmp2 = sigma(ntmp+1)
            tmp3 = 1.0d9
            if (abs(tmp2).gt.1.0d-12) tmp3=abs(tmp1/tmp2)
!       add a warning if no clear eigenvalue gap
            if (tmp3 .lt. 1.0d2) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: no clear eigenvalue gap'
               write(*,"(a)")' either the system has (near) symmetry or grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            end if
            if (ntmp.gt.nconstr-1) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: more non-zero than constraints'
               write(*,"(a)")' the grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            endif
!       enforce constraint eigenvalues to be zero
            do j=ntmp+1,ndimcon
               sigma(j) = 0.0d0
            end do
         endif
! we have explicit forced eigenvalues to zero, but keep svdcut just for good measure
         xmat=0.0d0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) xmat(i,i)=1.0d0/sigma(i)
         enddo
         jinv=matmul(matmul(vmat,xmat),transpose(umat))
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jinv(i,j),j=1,ndimcon)
!enddo



! calculate the step and update kappa
         sums=0.0d0
         do i=1,ndimcon
            tmp = 0.0d0
            do j=1,ndimcon
               tmp = tmp +jinv(i,j)*gkappa(j)
            enddo
!   write(*,"(a,i5,f12.6)")' step',i,-tmp
            step(i) = -tmp
            sums=sums+tmp*tmp
         enddo
         sums=dsqrt(sums)
!write(*,*)' step length',sums
         if (sums.gt.smax) then
            write(*,"(a,f12.6,a,f12.6)")' step',sums,' scaled down to',smax
!  write(*,*)sums
            sums=smax/sums
            step = sums*step
         endif

         tmpg1=g1norm
         tmpg2=g2norm
         tmpg3=g3norm
         tmpg4=g4norm
         if (.not.lcdip)  tmpg1=0.0d0
         if (.not.lcquad .and. .not.ldquad) tmpg2=0.0d0
         if (.not.lcoct .and. .not.ldoct .and. .not.lqoct) tmpg3=0.0d0
         if (.not.lchex .and. .not.ldhex .and. .not.lqhex .and. .not.lohex) tmpg4=0.0d0
         tmpg = tmpg1 + tmpg2 + tmpg3 + tmpg4
         ghist(ikappa)=tmpg

! frj: try to decide whether it is better to proceed to update the MBIS, than spending more time on the kappa...
         lgmon=.true.
         lgstuck=.false.
         if (ikappa.ge.3) then
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
            igmon=0
            do i=1,ikappa-1
               tmp = ghist(i)/ghist(i+1)
               if (tmp.lt.1.0d0) igmon=igmon+1
            end do
            if (igmon.ge.1) lgmon=.false.
!       if the last 3 iterations have made little progress, then it is stuck ...
            ghmax=0.0d0
            gsum =0.0d0
            do i=ikappa-2,ikappa
               tmp = ghist(i)
               if (tmp.gt.ghmax) ghmax=tmp
               gsum = gsum + tmp
            end do
            aveg = gsum/3.0d0
!       be more patient if close to convergence, indicated by lmult=.true.
            if (.not.lmult .and. ghmax.lt.2.0d0*aveg) lgstuck=.true.
            if (lmult .and. ghmax.lt.1.5d0*aveg) lgstuck=.true.
         end if

!write(*,*)'lgconv,lgmon,lgstuck',ikappa,lgconv,lgmon,lgstuck

         if (lgstuck .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' little g-improvements last 3 steps, proceeding to update MBIS parameters'
            goto 900
         end if

         if (tmpg.lt.2.0d0*gconv .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' g-norm is less than ',2.0d0*gconv,' and little improvements, proceeding to update MBIS parameters'
            goto 900
         end if

         if (ikappa.eq.kappamax) then
            write(*,"(a,i5,a)")' Failure to converge multipole constraints in iterations',kappamax,'   proceeding to update MBIS parameters'
            goto 900
         end if

         kappa = kappa + step

! end ikappa iterations
      end do

900   continue
!Include prefix part of Eq. 19 of MBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            alphaval11 = shsignew(ish,iatm,1,1)
            alphaval22 = shsignew(ish,iatm,2,2)
            alphaval33 = shsignew(ish,iatm,3,3)
            alphaval13 = shsignew(ish,iatm,1,3)
            alphaval12 = shsignew(ish,iatm,1,2)
            alphaval23 = shsignew(ish,iatm,2,3)

            det =0
            det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
            ! write(*,*) "det=", det

            if (abs(det)<1.0d-10) cycle

            shalphanew(ish,iatm,1,1)=1.0d0/det * (shsignew(ish,iatm,2,2)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,2,3)*shsignew(ish,iatm,2,3))
            shalphanew(ish,iatm,2,2)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,3))
            shalphanew(ish,iatm,3,3)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,2)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,2,1))
            shalphanew(ish,iatm,1,2)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,3,3) )
            shalphanew(ish,iatm,1,3)=1.0d0/det * (shsignew(ish,iatm,1,2)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,2) )
            shalphanew(ish,iatm,2,3)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,2)-shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,3) )
            shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,1,3)
            shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)
            shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,1,2)

            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,1)=shalphanew(ish,iatm,1,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,2)=shalphanew(ish,iatm,2,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,3)=shalphanew(ish,iatm,3,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,2)=shalphanew(ish,iatm,1,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,3)=shalphanew(ish,iatm,1,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,3)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,2,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,3,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))

         end do
      end do

!   update MBIS parameters and go for new kappa iteration
      shpop(:,:)=shpopnew(:,:)
      shalpha(:,:,:,:)=shalphanew(:,:,:,:)

      dCmax=maxval(abs(achg(1,:)-achgold(:)))
      lqconv=.false.
      if (dCmax.lt.qconv) lqconv=.true.

! turn on full multipole calculation if approaching convergence
      if (dCmax.lt.10.0d0*qconv) lmult=.true.
! be careful if tight convergence has been requested
      if (dCmax.lt.1.0d-4) lmult=.true.
! if lmult for some reason has not been turned on, but lqconv is true, reset it to go for one more cycle
      if (lqconv .and. .not.lmult) then
         lqconv=.false.
         lmult=.true.
      endif
! if lpmult is false, then all appears good, but no multipoles have been calculated, reset and go for one more cycle
      if (lqconv .and. lmult .and. .not.lpmult) then
         lqconv=.false.
         lmult=.true.
      endif

      tmpg = g1norm + g2norm + g3norm + g4norm

! try to decide from the history whether the decomposion is stuck due to insufficient numerical accuracy
! if less than 10 iterations, then just collect the information
! if more than 10 iterations, and nothing has changed for the last 10 iterations, make the decission to quit
! nothing is here defined as q is not converged, no monotonic convergence, and ratio of max to ave values is less than 3
      lqmon=.true.
      lqstuck=.false.
      lquit=.false.
      if (kpar.le.10) then
         qhist(kpar)=dCmax
      else
         do i=1,9
            qhist(i)=qhist(i+1)
         end do
         qhist(10)=dCmax
         qhmax=maxval(qhist(:))
         aveq = sum(qhist(:))/size(qhist(:))
         if (qhmax.lt.3.0d0*aveq) lqstuck=.true.
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
         iqmon=0
         do i=1,9
            tmp = qhist(i)/qhist(i+1)
            if (tmp.lt.1.0d0) iqmon=iqmon+1
         end do
         if (iqmon.ge.3) lqmon=.false.
      end if

!do i=1,10
!        write(*,"(i5,2f12.6)")kpar-10+i,qhist(i),ghist(i)
!end do

!write(*,*)'lqconv,lqmon,lqstuck',lqconv,lqmon,lqstuck

      g1max = 0.0d0
      g2max = 0.0d0
      g3max = 0.0d0
      g4max = 0.0d0
      do i=1,3
         if (abs(gkappa(i)).gt.g1max) then
            g1max=abs(gkappa(i))
         endif
      enddo
      do i=4,9
         if (abs(gkappa(i)).gt.g2max) then
            g2max=abs(gkappa(i))
         endif
      enddo
      do i=10,19
         if (abs(gkappa(i)).gt.g3max) then
            g3max=abs(gkappa(i))
         endif
      enddo
      do i=20,34
         if (abs(gkappa(i)).gt.g4max) then
            g4max=abs(gkappa(i))
         endif
      enddo

      lgaconv=.true.
      if (g1norm.gt.gconv) lgaconv=.false.
      if (g2norm.gt.gconv) lgaconv=.false.
      if (g3norm.gt.gconv) lgaconv=.false.
      if (g4norm.gt.gconv) lgaconv=.false.

! now try to make decissions ...
      if (lqconv .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         goto 901
      end if
      if (lqconv .and. .not.lgconv .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if
      if (lqstuck .and. .not. lgmon .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         lquit=.true.
      end if
      if (lqstuck .and. .not.lqmon .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if

      if (lquit) then
!        write(*,"(a,2f12.6)")' Very little C and G progress in the last 10 iterations'
!        do i=1,10
!                write(*,"(i5,2f12.6)")kpar-10+i,qhist(i),ghist(i)
!        end do
         write(*,"(a,2f12.6)")' Decomposition appears stuck, deciding to quit ...'
         write(*,"(a,2f12.6)")' Likely reason(s): insufficient grid accuracy or more constraints than atomic parameters'
         write(*,*)' '
         goto 901
      end if

      if (kpar.eq.maxcyc) then
         write(*,"(a,i5)")' Failure to converge atomic charges and constraints in iterations',maxcyc
         goto 901
      end if
      achgold=achg(1,:)
! end kpar loop for updating cMBIS parameters
   end do

901 continue

! output the final constrained results
   call eoutatommpl(10,4,maxshell,mshell(:),shpop(:,:),shalpha(:,:,:,:),shbeta,shbeta_rot,achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:),dsinfo)
! make final check that the sum of NAi matches the QA
   do iatm=1,ncenter
      tmp = 0.0d0
      do ishell=1,mshell(iatm)
         tmp = tmp + shpop(ishell,iatm)
      end do
      electmp = a(iatm)%charge - achg(1,iatm)
      if (abs(tmp-electmp).gt.crit) then
         write(*,"(a,i5,3f12.6)") 'normalization problem?',iatm,tmp,electmp
      end if
   end do

   write(*,*)' '
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo

   call walltime(iwalltime3)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime3-iwalltime2


end subroutine

!!============================ AEMBIS ============================!!
!!============================ AEMBIS ============================!!
!!============================ AEMBIS ============================!!
!!============================ AEMBIS ============================!!
!!============================ AEMBIS ============================!!

!!--------- Calculate EMBIS charge or atomic radial density. Suitable for both isolated and periodic systems
!itype: 1=Calculate and print charges =2: Only generate atomic spaces, namely filling "atmraddens" global array by final radial density of each atom
!imode:
!0=Atomic center grid, only for isolated systems
!1=Evenly distributed grid, calculate actual density from periodic wavefunction
!2=Evenly distributed grid, actual density is directly taken from grid data in memory
subroutine AEMBIS(itype,imode)
   use defvar
   use functions
   use util
   implicit real*8 (a-h,o-z)
   integer itype,imode
   type(content) gridatm(radpot*sphpot),gridatmorg(radpot*sphpot)
   real*8 charge(ncenter),lastcharge(ncenter) !Atomic charges of current iter. and last iter.
   real*8 beckeweigrid(radpot*sphpot),tvec(3), eigvec(3,3), eigval(3),eigvalmatrix(3,3)
   integer,parameter :: maxshell=6
   real*8 shpop(maxshell,ncenter),shsig(maxshell,ncenter,3,3),shalpha(maxshell,ncenter,3,3),shbeta(maxshell,ncenter,3)  !Shell populations and shell sigma (width)
   real*8 invalpha(3,3), currentalpha(3,3), rbeta, xyz(3)
   real*8 shpopnew(maxshell,ncenter),shsignew(maxshell,ncenter,3,3),shalphanew(maxshell,ncenter,3,3),K1(maxshell,ncenter,3),shbetanew(maxshell,ncenter,3),shbetanew_xyz(maxshell,ncenter,3) !New shell populations and shell sigma during iteration
   real*8 shpopnew_tmp(maxshell,ncenter),shsignew_tmp(maxshell,ncenter,3,3), shalpha_tmp(maxshell,ncenter,3,3), K1_tmp(maxshell,ncenter,3)
   real*8 rho0sh(maxshell,ncenter) !Shell density at current grid
   real*8 tmpdens(radpot*sphpot,ncenter) !tmpdens(ipt,iatm) corresponds to contribution of iatm to molecular density at grid ipt, and meantime multiplied by single-center integration weight at that point
   real*8 atmdis2min(ncenter), shbeta_rot(maxshell,ncenter,3)
   real*8 det, g,N,xx,yy,zz,xy,xz,yz,isotropic,anisotropy,sqrt_isotropic
   integer mshell(ncenter),Nummer,skal !Actual number of shells of atoms
   integer :: maxcyc=600,ioutmedchg=0,ioutshell=0,ignorefar=1,ishellconv=1,initembis=0
   real*8 :: crit=0.0001D0,eps=1D-14,dencut=1D-10
!frj arrays for atomic and molecular multipoles
   real*8 shellchg(maxshell,ncenter), shelldip(3,maxshell,ncenter), shellquad(6,maxshell,ncenter) ,atomvolume_tmp(ncenter)     ! shell charges, dipole and (Cartesian) quadrupole
   real*8 shelloct(10,maxshell,ncenter), shellhex(15,maxshell,ncenter), shellchg_tmp(maxshell,ncenter), shelldip_tmp(3,maxshell,ncenter), shellquad_tmp(6,maxshell,ncenter), shelloct_tmp(10,maxshell,ncenter), shellhex_tmp(15,maxshell,ncenter)  ! shell octupole, hexadecapole
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter), achgold(ncenter) ! atomic charge, dipole and quadrupole, previous charges
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)              ! atomic octupole, hexadecapole
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4)                               ! reconstructed molecular charge, dipole and quadrupole
   real*8 moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)                       ! reconstructed molecular octupole, hexadecapole
   real*8 atomvolume(ncenter),bondorder(ncenter,ncenter),bondorder_tmp(ncenter,ncenter)
!frj arrays for constrained MBIS
   logical lqconv,lgconv,lgaconv,lqmon,lgmon,lqstuck,lgstuck,lquit,lnumjacobi
   logical lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex
   logical lmult,lpmult,h_above_1
   real*8 dsinfo, dsinfo_tmp
   real*8 kappa(34),gkappa(34),jkappa(34,34),jinv(34,34),step(34)
   real*8 qhist(10),ghist(10)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)    ! the exact (reference) dipole, quadrupole, octupole, hexdecapole, as calculated by calc_multipole
   real*8 wtatm(maxshell,ncenter),jtatm(34,maxshell,ncenter)
   real*8 hkfunc(4,4,15),hjfunc(4,4,15),hhfunc(4,4,15)
! additional arrays for calculating Jacobian SVD
   real*8 umat(34,34),vmat(34,34),sigma(34)
   real*8 xmat(34,34),ymat(34,34)
! additional arrays for testing numerical vs. analytical Jacobian
   real*8 xxx(34,34),gtmp(2,34,34),jsave(34,34)
   character (len=200) :: line, navn
!frj: turn on numerical testing of the Jacobian, note that there are two additional places where this has to be turn on manually, search lnumjacobi to find these
!lnumjacobi=.true.
   lnumjacobi=.false.
!frj

   if (any(a%index>86)) then
      write(*,*) "Error: MBIS for atoms beyond Rn is not supported"
      write(*,*) "Press ENTER button to exit"
      read(*,*)
      return
   end if

   do while(.true.)
      write(*,*)
      call menutitle("AEMBIS",15,2)
      if (ishellconv==0) write(*,*) "-5 Toggle convergence between charge and shell, current: charge"
      if (ishellconv==1) write(*,*) "-5 Toggle convergence between charge and shell, current: shell "
      if (ignorefar==1) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: Yes"
      if (ignorefar==0) write(*,*) "-4 Toggle if reducing cost by ignoring atoms far from grid, current: No"
      if (initembis==0) write(*,"(a)") " -3 Toggle initial EMBIS parameters, default or EMBIS parameters, current: default"
      if (initembis==1) write(*,"(a)") " -3 Toggle initial EMBIS parameters, default or EMBIS parameters, current: EMBIS"
      if (ioutshell==1) write(*,*) "-2 Toggle if outputting population and width of shells, current: Yes"
      if (ioutshell==0) write(*,*) "-2 Toggle if outputting population and width of shells, current: No"
      if (ioutmedchg==1) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: Yes"
      if (ioutmedchg==0) write(*,*) "-1 Toggle if outputting atomic charges during iterations, current: No"
      write(*,*) "0 Return"
      write(*,*) "1 Start calculation!"
      write(*,"(a,i4)") " 2 Set the maximum number of iterations, current:",maxcyc
      write(*,"(a,f10.6)") " 3 Set convergence criterion of atomic charges, current:",crit
      read(*,*) isel
      if (isel==0) then
         return
      else if (isel==-5) then
         if (ishellconv==1) then
            ishellconv=0
         else
            ishellconv=1
         end if
      else if (isel==-4) then
         if (ignorefar==1) then
            ignorefar=0
         else
            ignorefar=1
         end if
      else if (isel==-3) then
         if (initembis==1) then
            initembis=0
         else
            initembis=1
            write(*,*) "name of xxx.embis_mpl file?"
            read(*,*) filename
         end if
      else if (isel==-2) then
         if (ioutshell==1) then
            ioutshell=0
         else
            ioutshell=1
         end if
      else if (isel==-1) then
         if (ioutmedchg==1) then
            ioutmedchg=0
         else
            ioutmedchg=1
         end if
      else if (isel==1) then
         exit
      else if (isel==2) then
         write(*,*) "Input maximum number of iterations, e.g. 30"
         read(*,*) maxcyc
      else if (isel==3) then
         write(*,*) "Input convergence criterion of atomic charges, e.g. 0.001"
         read(*,*) crit
      end if
   end do

!Prepare actual density of present system at integration points
   if (imode==0) then !Atomic center grids, only for isolated systems
      call walltime(iwalltime1)
      ntotpot=radpot*sphpot
      call gen1cintgrid(gridatmorg,iradcut)
      write(*,"(' Radial grids:',i4,'  Angular grids:',i5,'  Total:',i7,'  After pruning:',i7)") radpot,sphpot,radpot*sphpot,radpot*sphpot-iradcut*sphpot
      write(*,"(a)") " Calculating atomic contribution to electron density of present system on grid points..."
      ifinish=0
      call showprog(ifinish,ncenter)
      !$OMP PARALLEL DO SHARED(tmpdens,ifinish) PRIVATE(iatm,gridatm,beckeweigrid,dtmp) schedule(dynamic) NUM_THREADS(nthreads)
      do iatm=1,ncenter
         gridatm%value=gridatmorg%value
         gridatm%x=gridatmorg%x+a(iatm)%x
         gridatm%y=gridatmorg%y+a(iatm)%y
         gridatm%z=gridatmorg%z+a(iatm)%z
         call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
         do ipt=1+iradcut*sphpot,ntotpot
            dtmp = fdens(gridatm(ipt)%x,gridatm(ipt)%y,gridatm(ipt)%z)
            tmpdens(ipt,iatm) = dtmp*gridatm(ipt)%value*beckeweigrid(ipt)
         end do
         !$OMP CRITICAL
         ifinish=ifinish+1
         call showprog(ifinish,ncenter)
         !$OMP END CRITICAL
      end do
      !$OMP END PARALLEL DO
   else if (imode==1) then !Calculate density from periodic wavefunction
      call setgrid_for_PBC(0.2D0,1)
      call calc_dvol(dvol)
      if (allocated(cubmat)) deallocate(cubmat)
      allocate(cubmat(nx,ny,nz))
      call walltime(iwalltime1)
      write(*,*) "Calculating electron density grid data..."
      !Because uniform grid cannot integrate well core density, so temporarily disable EDFs
      nEDFprims_org=nEDFprims
      nEDFprims=0
      call delvirorb(1) !Delete high-lying virtual orbitals for faster calculation
      call savecubmat(1,0,1)
      call delvirorb_back(1) !Restore to previous wavefunction
      nEDFprims=nEDFprims_org
   else !Directly using loaded electron density from cub/VASP grid data, and transforming grid data information to cell information
      if (all(a%charge==0)) then
         write(*,*) "Error: All nuclear charges are zero! If this file was exported by CP2K, it is a bug. You need to manually &
            edit the file so that effective nuclear charges (column 2 since line 8) are correctly recorded, otherwise atomic charges cannot be calculated"
         write(*,*) "Press ENTER button to return"
         read(*,*)
         return
      end if
      call grid2cellinfo
      call calc_dvol(dvol)
      !call showcellinfo
      call walltime(iwalltime1)
   end if

!Set initial sigma and population of various shells
   shpop(:,:)       = 0.0d0
   shalpha(:,:,:,:) = 0.0d0
   shbeta(:,:,:) = 0.0d0
!write(*,*) " Initial guess for EMBIS parameters?"
!write(*,*) "---------------------------------"
!write(*,*) "1) the default MBIS guess"
!write(*,*) "2) from an MBIS mpl file"
!read(*,*) intp
   if (initembis==0) then
!if (intp==1) then

      icore=1 !If consider core shells. If =0, initial population of core shells will be 0, and core shells will not be utilized during iteration (population and sigma will be zero throughout iterations)
      !For density only representing valence electrons, I found ignoring core shells do not improve convergence. After first several iterations, core population automatically decreases to nearly zero

      do iatm=1,ncenter
         iele = a(iatm)%index
         if (iele==0) then !Ghost atom, initialize as shsig=1 and with a tiny population. This scheme is defined by frj
!frj bug fix in the original code
!        mshell=0
!        shsig(1,iatm) = 1
!        shpop(1,iatm)=1D-3
! frj turn off ignorefar since atmrhocutsqr has no suitable value for ghost atoms
            ignorefar = 0
            mshell(iatm)=1
            shalpha(1,iatm,1,1)=1.0d0
            shalpha(1,iatm,2,2)=1.0d0
            shalpha(1,iatm,3,3)=1.0d0
            shalpha(1,iatm,1,2)=0.0d0
            shalpha(1,iatm,1,3)=0.0d0
            shalpha(1,iatm,2,1)=0.0d0
            shalpha(1,iatm,2,3)=0.0d0
            shalpha(1,iatm,3,1)=0.0d0
            shalpha(1,iatm,3,2)=0.0d0
            shpop(1,iatm)=1D-2
         else if (iele<=2) then
            mshell(iatm) = 1
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,2)=0.0d0
            shalpha(1,iatm,1,3)=0.0d0
            shalpha(1,iatm,2,1)=0.0d0
            shalpha(1,iatm,2,3)=0.0d0
            shalpha(1,iatm,3,1)=0.0d0
            shalpha(1,iatm,3,2)=0.0d0
            shpop(1,iatm)=iele
         else if (iele<=10) then
            mshell(iatm) = 2
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            shalpha(2,iatm,1,1) = (2.0d0)**2
            shalpha(2,iatm,2,2) = (2.0d0)**2
            shalpha(2,iatm,3,3) = (2.0d0)**2
            shalpha(2,iatm,1,3) = 0.0d0
            shalpha(2,iatm,1,2) = 0.0d0
            shalpha(2,iatm,2,3) = 0.0d0
            shalpha(2,iatm,2,1) = 0.0d0
            shalpha(2,iatm,3,2) = 0.0d0
            shalpha(2,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            shpop(2,iatm)=iele-2
         else if (iele<=18) then
            mshell(iatm) = 3
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2 !OBS
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            shalpha(2,iatm,1,1) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,2,2) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,3,3) = (2.0d0*sqrt(dfloat(iele)))**2
            shalpha(2,iatm,1,3) = 0.0d0
            shalpha(2,iatm,1,2) = 0.0d0
            shalpha(2,iatm,2,3) = 0.0d0
            shalpha(2,iatm,2,1) = 0.0d0
            shalpha(2,iatm,3,2) = 0.0d0
            shalpha(2,iatm,3,1) = 0.0d0
            shalpha(3,iatm,1,1) = (2.0d0)**2
            shalpha(3,iatm,2,2) = (2.0d0)**2
            shalpha(3,iatm,3,3) = (2.0d0)**2
            shalpha(3,iatm,1,3) = 0.0d0
            shalpha(3,iatm,1,2) = 0.0d0
            shalpha(3,iatm,2,3) = 0.0d0
            shalpha(3,iatm,2,1) = 0.0d0
            shalpha(3,iatm,3,2) = 0.0d0
            shalpha(3,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            shpop(3,iatm)=iele-10
         else if (iele<=36) then
            mshell(iatm) = 4
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,3
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,3,3) = (2.0d0*iele**(1-(dfloat(ishell-1)/(mshell(iatm)-1))))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do

            shalpha(4,iatm,1,1) = (2.0d0)**2
            shalpha(4,iatm,2,2) = (2.0d0)**2
            shalpha(4,iatm,3,3) = (2.0d0)**2
            shalpha(4,iatm,1,3) = 0.0d0
            shalpha(4,iatm,1,2) = 0.0d0
            shalpha(4,iatm,2,3) = 0.0d0
            shalpha(4,iatm,2,1) = 0.0d0
            shalpha(4,iatm,3,2) = 0.0d0
            shalpha(4,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            shpop(4,iatm)=iele-18
         else if (iele<=54) then
            mshell(iatm) = 5
!       shalpha(1,iatm) = (2*iele)
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,4
               !        shalpha(ishell,iatm) = (2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,3,3) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do
!        shalpha(5,iatm) = 2
            shalpha(5,iatm,1,1) = (2.0d0)**2
            shalpha(5,iatm,2,2) = (2.0d0)**2
            shalpha(5,iatm,3,3) = (2.0d0)**2
            shalpha(5,iatm,1,3) = 0.0d0
            shalpha(5,iatm,1,2) = 0.0d0
            shalpha(5,iatm,2,3) = 0.0d0
            shalpha(5,iatm,2,1) = 0.0d0
            shalpha(5,iatm,3,2) = 0.0d0
            shalpha(5,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            if (icore==1) shpop(4,iatm)=18
            shpop(5,iatm)=iele-36
         else if (iele<=86) then
            mshell(iatm) = 6
            shalpha(1,iatm,1,1) = (2.0d0*iele)**2
            shalpha(1,iatm,2,2) = (2.0d0*iele)**2
            shalpha(1,iatm,3,3) = (2.0d0*iele)**2
            shalpha(1,iatm,1,3) = 0.0d0
            shalpha(1,iatm,1,2) = 0.0d0
            shalpha(1,iatm,2,3) = 0.0d0
            shalpha(1,iatm,2,1) = 0.0d0
            shalpha(1,iatm,3,2) = 0.0d0
            shalpha(1,iatm,3,1) = 0.0d0
            do ishell=2,5
               !        shalpha(ishell,iatm) = (2*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))
               shalpha(ishell,iatm,1,1) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,2,2) = (2.0d0*iele**(1-dfloat(ishell-1)/(mshell(iatm)-1)))**2
               shalpha(ishell,iatm,1,2) = 0.0d0
               shalpha(ishell,iatm,1,3) = 0.0d0
               shalpha(ishell,iatm,2,3) = 0.0d0
               shalpha(ishell,iatm,2,1) = 0.0d0
               shalpha(ishell,iatm,3,1) = 0.0d0
               shalpha(ishell,iatm,3,2) = 0.0d0
            end do
!        shalpha(6,iatm) = 2
            shalpha(6,iatm,1,1) = (2.0d0)**2
            shalpha(6,iatm,2,2) = (2.0d0)**2
            shalpha(6,iatm,3,3) = (2.0d0)**2
            shalpha(6,iatm,1,3) = 0.0d0
            shalpha(6,iatm,1,2) = 0.0d0
            shalpha(6,iatm,2,3) = 0.0d0
            shalpha(6,iatm,2,1) = 0.0d0
            shalpha(6,iatm,3,2) = 0.0d0
            shalpha(6,iatm,3,1) = 0.0d0
            if (icore==1) shpop(1,iatm)=2
            if (icore==1) shpop(2,iatm)=8
            if (icore==1) shpop(3,iatm)=8
            if (icore==1) shpop(4,iatm)=18
            if (icore==1) shpop(5,iatm)=18
            shpop(6,iatm)=iele-54
         end if
      end do
!else if(intp==2) then
   else if(initembis==1) then
!       filename should already be read
      open(unit=10, file=filename, status='old', action='read')
      do
         read(10, '(A)',iostat=istatus) line
         if (istatus /= 0) then
            write(*,*) 'reached the end'
            stop
         end if
!        write(ifileid,'(a)')'  Atom  Number Shell   Npop           Sigma          Alpha'
!                if (index(line,"Atom Atom_nummer  Shell   Npop           Sigma         Alpha") > 0) then
         if (index(line,"Atom  Number Shell   Npop           Alpha: xx xy xz yy yz zz") > 0) then
            exit
         end if
      end do
      do
         read(10,*,iostat=istatus) navn, Nummer, skal,N, xx, xy,xz,yy,yz,zz,isotropic,anisotropy,sqrt_isotropic
         !write(*,*) "DATA", skal, Nummer, xa
         shpop(skal,Nummer)=N
         mshell(Nummer)=skal
         shalpha(skal,Nummer,1,1) = xx
         shalpha(skal,Nummer,2,2) = yy
         shalpha(skal,Nummer,3,3) = zz
         shalpha(skal,Nummer,1,2) = xy
         shalpha(skal,Nummer,2,1) = xy
         shalpha(skal,Nummer,1,3) = xz
         shalpha(skal,Nummer,3,1) = xz
         shalpha(skal,Nummer,2,3) = yz
         shalpha(skal,Nummer,3,2) = yz
         !write(*,*) "nr,skal,a11,n", Nummer,skal,shalpha(skal,Nummer,1,1), shpop(skal,Nummer)
         if (istatus/= 0) exit
      end do
      close(10)
   end if
   write(*,*)
   write(*,*) "Performing AEMBIS iterations to refine atomic spaces..."
   lastcharge=0


! lmult turns on all multipole calculations when close to convergence
!       this saves ~10% computational time compared to calculating them in each MBIS iteration
   lmult=.false.
   h_above_1=.false.
   do icyc=1,maxcyc
      if (ioutmedchg==1) write(*,*)
      if (icyc==1) then
         write(*,"(' Cycle',i5)") icyc
      else
         write(*,"(' Cycle',i5,'   Maximum change:',f12.8)") icyc,varmax
      end if
      !Monitor population and width of shells
      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpop(1:mshell(iatm),iatm))
      !end do
      !write(*,*) "Width (sigma) of each shell in Bohr"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm),ish=1,mshell(iatm))
      !end do

      shpopnew(:,:)=0 !New population of shells of various atoms
      shalphanew(:,:,:,:)=0
      shbetanew(:,:,:)=0
      shsignew(:,:,:,:)=0 !New sigma of shells of various atoms
!       frj initialization for shell multipoles
      K1(:,:,:)=0
      shellchg = 0.0d0
      shelldip = 0.0d0
      shellquad = 0.0d0
      shelloct  = 0.0d0
      shellhex  = 0.0d0
      dsinfo = 0.0d0
!       frj initialization for atomic volumen and atom-atom bond order
      atomvolume = 0.0d0
      bondorder = 0.0d0
! frj
      if (imode==0) then !Using multicenter integration to evaluate population of various shells of various atoms based on present sigma (Eq. 18 of MBIS paper)
         ifinish=0
         ntmp=floor(ny*nz/100D0)
         !$OMP PARALLEL SHARED(shpopnew,shsignew,K1,atomvolume,shellchg,ifinish,ishowprog,bondorder,dsinfo) PRIVATE(gridatm,beckeweigrid,det,invalpha,g,h,rbeta,currentalpha,xyz,jatm,shpopnew_tmp,atomvolume_tmp,shsignew_tmp,K1_tmp,i,j,k,rho0sh,rho0,tmpx,tmpy,tmpz,tvec, &
         !$OMP ic,jc,kc,icell,jcell,kcell,iatm,katm,dx,dy,dz,dis,dis2,dis3,dis2min,ishell,kshell,shellchg_tmp,shelldip_tmp,shellquad_tmp,shelloct_tmp,shellhex_tmp,dstmp,sigval,wtmp,tmp,tmp2,tmp3,tmpden,atmdis2min,wjtmp,wktmp,bondorder_tmp,dsinfo_tmp)
         shpopnew_tmp(:,:)=0
         shsignew_tmp(:,:,:,:)=0
         K1_tmp(:,:,:)=0
         bondorder_tmp(:,:)=0
         dsinfo_tmp=0
         atomvolume_tmp(:)=0
         shellchg_tmp(:,:)=0
         shelldip_tmp(:,:,:)=0
         shellquad_tmp(:,:,:)=0
         shelloct_tmp(:,:,:)=0
         shellhex_tmp(:,:,:)=0

         !$OMP DO schedule(dynamic)
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            ! frj
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)     ! frj
            do ipt=1+iradcut*sphpot,ntotpot
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper

               ! Shell density is a normalized exponential and reference/model density is the sum of shell densities
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     currentalpha(:,:) = shalpha(ishell,jatm,:,:)
                     xyz(:) = (/dx,dy,dz/)

                     det=detmat(currentalpha)
                     !det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
                     invalpha(:,:) = invmat(currentalpha,3)

                     g=0.0d0
                     !g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                     g = dot_product(xyz,matmul(currentalpha,xyz))

                     h = 0.0d0

                     !write(*,"(i5,'(',a,') Shell',i2,'(beta):',3f12.6)") &
                     !jatm, a(jatm)%name, ishell, shbeta(ishell,jatm,:)

                     !write(*,"(i5,'(',a,') Shell',i2,'(invalpha*beta):',3f12.6)") &
                     !jatm, a(jatm)%name, ishell, matmul(invalpha(:,:),shbeta(ishell,jatm,:))

                     h = dot_product(shbeta(ishell,jatm,:),matmul(invalpha(:,:),shbeta(ishell,jatm,:)))

                     ! if (abs(g)>100000) cycle
                     rbeta = dot_product(xyz,shbeta(ishell,jatm,:))
                     !                   if (icyc==13) then
                     !                               write(*,"(i5,'(',a,') Shell',i2,'(alpha):')") iatm, a(iatm)%name, ish
                     ! ! Printing the 3x3 matrix row by row
                     ! write(*,"(12x,3f12.6)") currentalpha(1,:)
                     ! write(*,"(12x,3f12.6)") currentalpha(2,:)
                     ! write(*,"(12x,3f12.6)") currentalpha(3,:)
                     !             write(*,"(i5,'(',a,') Shell',i2,'(rbeta):',3f12.6)") &
                     !             jatm, a(jatm)%name, ishell, rbeta
                     !                                  write(*,"(i5,'(',a,') Shell',i2,'(h):',3f12.6)") &
                     !             jatm, a(jatm)%name, ishell, h
                     !                                  write(*,"(i5,'(',a,') Shell',i2,'(g):',3f12.6)") &
                     !             jatm, a(jatm)%name, ishell, g
                     !                                  write(*,"(i5,'(',a,') Shell',i2,'(det):',3ES14.6)") &
                     !             jatm, a(jatm)%name, ishell, det
                     !                                  write(*,"(i5,'(',a,') Shell',i2,'(shpop):',3f12.6)") &
                     !             jatm, a(jatm)%name, ishell, shpop(ishell,jatm)
                     !             end if

                     tmp = shpop(ishell,jatm)*dsqrt(det)/8/pi * (1-h)**2*exp(-dsqrt(g)+rbeta) !Eq. 7 of MBIS paper
                     if (tmp<dencut) tmp = 0 !I don't know why frj introduced this criterion. Seems that this can make insignificant grid ignored and reduce cost (because of wtot>0)?
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do
               !Accumulate contribution of this integration grid to new population and sigma of shells
               tmpden = tmpdens(ipt,iatm)
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     dx = gridatm(ipt)%x - a(jatm)%x
                     dy = gridatm(ipt)%y - a(jatm)%y
                     dz = gridatm(ipt)%z - a(jatm)%z
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis  = dsqrt(dis2)
                     dis3 = dis*dis2
                     dstmp  = 0.0d0          ! frj
                     do ishell=1,mshell(jatm)
                        currentalpha(:,:) = shalpha(ishell,jatm,:,:)
                        xyz(:) = (/dx,dy,dz/)

                        g=0.0d0
                        !g =alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                        g = dot_product(xyz,matmul(currentalpha,xyz))

                        shpopnew_tmp(ishell,jatm) = shpopnew_tmp(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/rho0 !Eq. 18 of MBIS paper, same for AEMBIS

                        !        if (abs(dsqrt(g))<1.0d-8) cycle  ! HER ER FEJLEN!!!! I OBT 3

                        shsignew_tmp(ishell,jatm,1,1) = shsignew_tmp(ishell,jatm,1,1) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 45 of EMBIS paper
                        shsignew_tmp(ishell,jatm,2,2) = shsignew_tmp(ishell,jatm,2,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dy)/(dsqrt(g))
                        shsignew_tmp(ishell,jatm,3,3) = shsignew_tmp(ishell,jatm,3,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dz*dz)/(dsqrt(g))
                        shsignew_tmp(ishell,jatm,1,2) = shsignew_tmp(ishell,jatm,1,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dy)/(dsqrt(g))
                        shsignew_tmp(ishell,jatm,1,3) = shsignew_tmp(ishell,jatm,1,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dz)/(dsqrt(g))
                        shsignew_tmp(ishell,jatm,2,3) = shsignew_tmp(ishell,jatm,2,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dz)/(dsqrt(g))
                        shsignew_tmp(ishell,jatm,2,1) = shsignew_tmp(ishell,jatm,1,2)
                        shsignew_tmp(ishell,jatm,3,1) = shsignew_tmp(ishell,jatm,1,3)
                        shsignew_tmp(ishell,jatm,3,2) = shsignew_tmp(ishell,jatm,2,3)

                        K1_tmp(ishell,jatm,1) = K1_tmp(ishell,jatm,1) + tmpden*rho0sh(ishell,jatm)/rho0*(dx) !K1 Integral of Eq. 68 of AEMBIS paper
                        K1_tmp(ishell,jatm,2) = K1_tmp(ishell,jatm,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dy)
                        K1_tmp(ishell,jatm,3) = K1_tmp(ishell,jatm,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dz)

                        ! frj generate atomic multipoles and dSinfo
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/rho0
                        atomvolume_tmp(jatm) = atomvolume_tmp(jatm) + dis3*wtmp
                        shellchg_tmp(ishell,jatm) = shellchg_tmp(ishell,jatm) + wtmp
!                                                       frj: calculate multipoles only if close to convergence, this saves some time
                        if (lmult) call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,.true.,shelldip_tmp,shellquad_tmp,shelloct_tmp,shellhex_tmp)
! frj:                                                  accumulate bond order
                        do katm=1,ncenter
                           do kshell=1,mshell(katm)
                              wjtmp = rho0sh(ishell,jatm)/rho0
                              wktmp = rho0sh(kshell,katm)/rho0
                              bondorder_tmp(jatm,katm) = bondorder_tmp(jatm,katm) + wjtmp*wktmp*tmpden
!                             write(*,"(4i5,3d15.4)")jatm,ishell,katm,kshell,wjtmp,wktmp,tmpden
                           enddo
                        enddo
                     end do
!                                               actual density: rho1
!                                               model density:  rho2
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo_tmp = dsinfo_tmp + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do
         !$OMP END DO
         !$OMP CRITICAL
         shpopnew(:,:)=shpopnew(:,:)+shpopnew_tmp(:,:)
         shsignew(:,:,:,:)=shsignew(:,:,:,:)+shsignew_tmp(:,:,:,:)
         K1(:,:,:)=K1(:,:,:)+K1_tmp(:,:,:)
         bondorder(:,:) = bondorder(:,:) + bondorder_tmp(:,:)
         dsinfo = dsinfo + dsinfo_tmp
         atomvolume(:)=atomvolume(:)+atomvolume_tmp(:)
         shellchg(:,:) = shellchg(:,:)+shellchg_tmp(:,:)
         shelldip(:,:,:) = shelldip(:,:,:)+shelldip_tmp(:,:,:)
         shellquad(:,:,:) = shellquad(:,:,:)+shellquad_tmp(:,:,:)
         shelloct(:,:,:) = shelloct(:,:,:)+shelloct_tmp(:,:,:)
         shellhex(:,:,:) = shellhex(:,:,:)+shellhex_tmp(:,:,:)
         !$OMP END CRITICAL
         !$OMP END PARALLEL

      else !Using evenly distributed grids
         ifinish=0
         ntmp=floor(ny*nz/100D0)
         !$OMP PARALLEL SHARED(shpopnew,shsignew,ifinish,ishowprog) PRIVATE(shpopnew_tmp,shsignew_tmp,i,j,k,rho0sh,rho0,tmpx,tmpy,tmpz,tvec, &
         !$OMP ic,jc,kc,icell,jcell,kcell,iatm,dx,dy,dz,dis,dis2,dis2min,ishell,sigval,tmp,tmp2,tmp3,tmpden,atmdis2min) NUM_THREADS(nthreads)
         shpopnew_tmp(:,:)=0
         shsignew_tmp(:,:,:,:)=0
         !$OMP DO schedule(dynamic) collapse(2)
         do k=1,nz
            do j=1,ny
               do i=1,nx
                  if (cubmat(i,j,k)<1D-10) cycle
                  rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
                  rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
                  call getgridxyz(i,j,k,tmpx,tmpy,tmpz)
                  !call getpointcell(tmpx,tmpy,tmpz,ic,jc,kc)
                  atmdis2min(:)=1D10
                  do icell=-PBCnx,+PBCnx
                     do jcell=-PBCny,+PBCny
                        do kcell=-PBCnz,+PBCnz
                           call tvec_PBC(icell,jcell,kcell,tvec)
                           do iatm=1,ncenter
                              dx=a(iatm)%x+tvec(1)-tmpx
                              dy=a(iatm)%y+tvec(2)-tmpy
                              dz=a(iatm)%z+tvec(3)-tmpz
                              dis2=dx*dx+dy*dy+dz*dz
                              if (dis2<atmdis2min(iatm)) atmdis2min(iatm)=dis2
                              if (dis2>atmrhocutsqr(a(iatm)%index)) cycle !Ignore atoms that do not contribute notably to present grid
                              dis=dsqrt(dis2)
                              do ishell=1,mshell(iatm)
                                 alphaval11 = shalpha(ishell,iatm,1,1)
                                 alphaval22 = shalpha(ishell,iatm,2,2)
                                 alphaval33 = shalpha(ishell,iatm,3,3)
                                 alphaval13 = shalpha(ishell,iatm,1,3)
                                 alphaval12 = shalpha(ishell,iatm,1,2)
                                 alphaval23 = shalpha(ishell,iatm,2,3)
                                 alphaval31 = alphaval13
                                 alphaval21 = alphaval12
                                 alphaval32 = alphaval23

                                 det=0
                                 det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23

                                 g=0
                                 g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz

                                 tmp = shpop(ishell,iatm)*dsqrt(det)/8/pi*exp(-dsqrt(g)) !Eq. 7 of MBIS paper
                                 rho0sh(ishell,iatm) =  tmp
                                 rho0 = rho0 + tmp
                              end do
                           end do
                        end do
                     end do
                  end do

                  !Accumulate contribution of this integration grid to new population and sigma of shells
                  tmpden = cubmat(i,j,k)*dvol
                  if (rho0>0.and.tmpden>eps) then
                     do iatm=1,ncenter
                        tmp2=tmpden/rho0
                        tmp3=tmp2*dsqrt(atmdis2min(iatm))
                        do ishell=1,mshell(iatm)
                           alphaval11 = shalpha(ishell,iatm,1,1)
                           alphaval22 = shalpha(ishell,iatm,2,2)
                           alphaval33 = shalpha(ishell,iatm,3,3)
                           alphaval13 = shalpha(ishell,iatm,1,3)
                           alphaval12 = shalpha(ishell,iatm,1,2)
                           alphaval23 = shalpha(ishell,iatm,2,3)

                           g=0
                           g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                           !write(*,*) "G=",g
                           if (abs(g)<1.0d-15) cycle
                           shpopnew_tmp(ishell,iatm) = shpopnew(ishell,iatm) + tmpden*rho0sh(ishell,iatm)/rho0 !Eq. 18 of MBIS paper

                           shsignew_tmp(ishell,iatm,1,1) = shsignew(ishell,iatm,1,1) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 19 of MBIS paper
                           shsignew_tmp(ishell,iatm,2,2) = shsignew(ishell,iatm,2,2) + tmpden*rho0sh(ishell,iatm)/rho0*(dy*dy)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,3,3) = shsignew(ishell,iatm,3,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dz*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,1,2) = shsignew(ishell,iatm,1,2) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dy)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,1,3) = shsignew(ishell,iatm,1,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dx*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,2,3) = shsignew(ishell,iatm,2,3) + tmpden*rho0sh(ishell,iatm)/rho0*(dy*dz)/(dsqrt(g))
                           shsignew_tmp(ishell,iatm,2,1) = shsignew_tmp(ishell,iatm,1,2)
                           shsignew_tmp(ishell,iatm,3,1) = shsignew_tmp(ishell,iatm,1,3)
                           shsignew_tmp(ishell,iatm,3,2) = shsignew_tmp(ishell,iatm,2,3)

                        end do
                     end do
                  end if
               end do
               !$OMP CRITICAL
               ifinish=ifinish+1
               ishowprog=mod(ifinish,ntmp)
               if (ishowprog==0) call showprog(floor(100D0*ifinish/(ny*nz)),100)
               !$OMP END CRITICAL
            end do
         end do
         !$OMP END DO
         !$OMP CRITICAL
         shpopnew(:,:)=shpopnew(:,:)+shpopnew_tmp(:,:)
         shsignew(:,:,:,:)=shsignew(:,:,:,:)+shsignew_tmp(:,:,:,:)
         !$OMP END CRITICAL
         !$OMP END PARALLEL
         if (ishowprog/=0) call showprog(100,100)
      end if

      !write(*,*) "Population of each shell"
      !do iatm=1,ncenter
      !	write(*,"(i5,'(',a,'):',6f10.6,' q(atm):',f11.6)") iatm,a(iatm)%name,(shpopnew(ish,iatm),ish=1,6),a(iatm)%charge-sum(shpopnew(1:mshell(iatm),iatm))
      !end do
!	write(*,*) "Width (sigma) of each shell in Bohr"
!	do iatm=1,ncenter
!		write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shalpha(ish,iatm,1,1),ish=1,mshell(iatm))
!	end do
      !   write(*,*) "--------------------------"

      !Calculate new alphas from Eq. 72 of AEMBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            currentalpha(:,:) = shalpha(ish,iatm,:,:)
            invalpha(:,:) = invmat(currentalpha,3)

            h = 0.0d0
            h = dot_product(shbeta(ish,iatm,:),matmul(invalpha,shbeta(ish,iatm,:)))
            ! write(*,*) 'size of h:', h
            h_above_1 = (h > 1 .or. h < 0)
            

            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,1)=shsignew(ish,iatm,1,1) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,1)*K1(ish,iatm,1)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,2)=shsignew(ish,iatm,2,2) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,2)*K1(ish,iatm,2)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,3)=shsignew(ish,iatm,3,3) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,3)*K1(ish,iatm,3)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,2)=shsignew(ish,iatm,1,2) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,1)*K1(ish,iatm,2)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,3)=shsignew(ish,iatm,1,3) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,1)*K1(ish,iatm,3)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,3)=shsignew(ish,iatm,2,3) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,2)*K1(ish,iatm,3)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,1)=shsignew(ish,iatm,2,1) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,2)*K1(ish,iatm,1)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,1)=shsignew(ish,iatm,3,1) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,3)*K1(ish,iatm,1)
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,2)=shsignew(ish,iatm,3,2) - (1-h)/4/(shpopnew(ish,iatm))*K1(ish,iatm,3)*K1(ish,iatm,2)

            shalphanew(ish,iatm,:,:) = invmat(shalphanew(ish,iatm,:,:)/shpopnew(ish,iatm),3)

            ! Printing header for each shell of the atom
            !write(*,"(i5,'(',a,') Shell',i2,'(alpha):')") iatm, a(iatm)%name, ish
            ! Printing the 3x3 matrix row by row
            !write(*,"(12x,3f12.6)") shalphanew(ish,iatm,1,:)
            !write(*,"(12x,3f12.6)") shalphanew(ish,iatm,2,:)
            !write(*,"(12x,3f12.6)") shalphanew(ish,iatm,3,:)

            eigvalmatrix(:,:) = shalphanew(ish,iatm,:,:)
            call diagsymat(eigvalmatrix(:,:),eigvec,eigval,istat)
            ! Printing header for each shell of the atom
            !write(*,"(i5,'(',a,') Shell',i2,'(diagonal alpha):')") iatm, a(iatm)%name, ish
            ! Printing the 3x3 matrix row by row
            !write(*,"(12x,3f12.6)") eigvalmatrix(1,:)
            !write(*,"(12x,3f12.6)") eigvalmatrix(2,:)
            !write(*,"(12x,3f12.6)") eigvalmatrix(3,:)
            !write(*,"(i5,'(',a,') Shell',i2,'(alpha aigenvectors):')") iatm, a(iatm)%name, ish

            ! Printing the 3x3 matrix row by row
            !write(*,"(12x,3f12.6)") eigvec(1,:)
            !write(*,"(12x,3f12.6)") eigvec(2,:)
            !write(*,"(12x,3f12.6)") eigvec(3,:)

            shbetanew(ish,iatm,1) = (1-h)/4/shpopnew(ish,iatm)*K1(ish,iatm,1)
            shbetanew(ish,iatm,2) = (1-h)/4/shpopnew(ish,iatm)*K1(ish,iatm,2)
            shbetanew(ish,iatm,3) = (1-h)/4/shpopnew(ish,iatm)*K1(ish,iatm,3)
            !            write(*,"(i5,'(',a,') Shell',i2,'(c = alpha^-1 beta):',3f12.6)") &
            !iatm, a(iatm)%name, ish, shbetanew(ish,iatm,:)
            ! Printing the 3 components of the beta vector on one line
            !write(*,"(i5,'(',a,') Shell',i2,'(beta = alpha c):',3f12.6)") &
            !iatm, a(iatm)%name, ish, matmul(shalphanew(ish,iatm,:,:),shbetanew(ish,iatm,:))

            shbetanew(ish,iatm,:) = matmul(transpose(eigvec),shbetanew(ish,iatm,:))
            shbetanew(ish,iatm,:) = matmul(eigvalmatrix,shbetanew(ish,iatm,:))
            ! Printing the 3 components of the beta vector on one line
            !write(*,"(i5,'(',a,') Shell',i2,'(beta in diagonal alpha):',3f12.6)") &
            !iatm, a(iatm)%name, ish, shbetanew(ish,iatm,:)
            shbetanew_xyz(ish,iatm,:) = matmul(eigvec,shbetanew(ish,iatm,:))
            ! if (a(iatm)%name == 'H') shbetanew(ish,iatm,:) = 0.0d0
            ! Printing the 3 components of the beta vector on one line
            !write(*,"(i5,'(',a,') Shell',i2,'(old beta):',3f12.6)") &
            !iatm, a(iatm)%name, ish, shbeta(ish,iatm,:)
            !write(*,"(i5,'(',a,') Shell',i2,'(updated beta):',3f12.6)") &
            !iatm, a(iatm)%name, ish, shbetanew(ish,iatm,:)
            !write(*,"(i5,'(',a,') Shell',i2,'(updated beta(restricted version)):',3f12.6)") &
            !iatm, a(iatm)%name, ish, shbeta(ish,iatm,:) + max(min(shbetanew(ish,iatm,:) - shbeta(ish,iatm,:), 0.01), -0.01)
         end do
      end do

      !Summing up shell populations to atomic population and get atomic charge
      do iatm=1,ncenter
         tmppop=sum(shpopnew(1:mshell(iatm),iatm)) !Atomic population
         if (nEDFelec==0.or.imode>0) then !Note that EDFs were not involved in evaluating system density when using even grids (imode>0)
            charge(iatm) = a(iatm)%charge - tmppop
         else !EDF is used for some atoms. Core electron density represented by EDF has been integrated, so nuclear charge should be augmented by nEDFelecatm
            charge(iatm) = a(iatm)%charge+nEDFelecatm(iatm) - tmppop
         end if
         if (ioutmedchg==1) write(*,"(i5,'(',a,')   charge:',f12.6)") iatm,a(iatm)%name,charge(iatm)
      end do


!Check convergence, choice between converging on charges (sum of shell-populations) or shell-alpha (exponents)
      varmax=maxval(abs(charge(:)-lastcharge(:)))
      varsig=maxval(abs(shalphanew(:,:,:,:)-shalpha(:,:,:,:)))
!       frj: turn on multipole calculation if approaching convergence
      if (varmax<10.0d0*crit .and. ishellconv==0) lmult=.true.
      if (varsig<10.0d0*crit .and. ishellconv==1) lmult=.true.
!       be careful if tight convergence has been requested
      if (varmax<1.0d-4 .and. ishellconv==0) lmult=.true.
      if (varsig<1.0d-4 .and. ishellconv==1) lmult=.true.

!frj : orginal code
!	if (varmax<crit.or.icyc==maxcyc) then
!                if (varmax<crit) write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
!                if (icyc==maxcyc) write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
!		exit
!	end if
!frj : new code, introducing convergence on shsig
      if (icyc==maxcyc) then
         write(*,"(/,' Convergence failed within',i4,' cycles!')") maxcyc
         exit
      end if
      if (varmax<crit .and. ishellconv==0) then
         write(*,"(/,a,f10.6)") " All atomic charges have converged to criterion of",crit
         exit
      end if
      if (varsig<crit .and. ishellconv==1) then
         write(*,"(/,a,f10.6)") " All atomic shell alphas have converged to criterion of",crit
         exit
      end if
      if (h_above_1) then
         write(*,*) "Program stopped due to beta^t alpha^-1 beta > 1"
         exit
      end if

      !Update atomic charges, shell population and sigma
      lastcharge(:)=charge(:)
      shpop(:,:)=shpopnew(:,:)
      shalpha(:,:,:,:)=shalphanew(:,:,:,:)
      shbeta(:,:,:) = shbetanew_xyz(:,:,:)
      shbeta_rot(:,:,:) = shbetanew(:,:,:)
   end do

   write(*,"(' Sum of all raw charges:',f14.8)") sum(charge(:))
!Normalize atomic charges. This is not feasible if only grid data is available, &
!because in this case the nelec used in "normalize_atmchg" is simply guessed by assuming system is neutral
   if (imode==1) call normalize_atmchg(charge(:))
!Print final atomic charges
   call printatmchg(charge(:))

   write(*,*)' '
   write(*,*)' Atomic volumes, defined as Int(r^3*rho), in au'
   do iatm=1,ncenter
      write(*,"(i5,f12.6)")iatm,atomvolume(iatm)
   enddo
   write(*,*)' '
   write(*,*)' Bond order matrix, only values larger than 0.05 are printed'
   do iatm=1,ncenter-1
      do jatm=iatm+1,ncenter
         tmp = bondorder(iatm,jatm)
         if (tmp.gt.0.05d0) write(*,"(2i5,f12.4)")iatm,jatm,tmp
!                write(*,*)iatm,jatm,tmp
      enddo
   enddo


   if (allocated(frag1)) then
      write(*,"(/,' Fragment charge:',f14.8)") sum(charge(frag1))
      write(*,"(' Fragment population:',f14.8)") sum(a(frag1)%charge) - sum(charge(frag1))
   end if

   if (ioutshell==1) then
      write(*,*)
      write(*,*) "Population of each shell"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,mshell(iatm))
      end do
      write(*,*)
      write(*,*) "Width (sigma) of each shell in Bohr"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm,1,1),ish=1,mshell(iatm))
      end do
!frj
      write(*,*) "Alpha of each shell in Bohr-1"
      do iatm=1,ncenter
         write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(1.0d0/shsig(ish,iatm,1,1),ish=1,mshell(iatm))
      end do
!frj
   end if
   write(*,*)
   write(*,*) "Alpha matrix of each shell (Bohr^-2)"
   do iatm=1,ncenter
      do ish=1,mshell(iatm)
         ! Printing header for each shell of the atom
         write(*,"(i5,'(',a,') Shell',i2,':')") iatm, a(iatm)%name, ish
         ! Printing the 3x3 matrix row by row
         write(*,"(12x,3f12.6)") shalpha(ish,iatm,1,:)
         write(*,"(12x,3f12.6)") shalpha(ish,iatm,2,:)
         write(*,"(12x,3f12.6)") shalpha(ish,iatm,3,:)
      end do
   end do

   write(*,*)
   write(*,*) "Beta vector of each shell (Bohr^-1)"
   do iatm=1,ncenter
      do ish=1,mshell(iatm)
         ! Printing the 3 components of the beta vector on one line
         write(*,"(i5,'(',a,') Shell',i2,':',3f12.6)") &
            iatm, a(iatm)%name, ish, shbeta_rot(ish,iatm,:)
      end do
   end do

   write(*,*)
   write(*,*) "(betaT alpha-1 beta) of each shell"
   do iatm=1,ncenter
      do ish=1,mshell(iatm)
         invalpha(:,:) = invmat(shalpha(ish,iatm,:,:),3)
         write(*,"(i5,'(',a,') Shell',i2,':',3f12.6)") &
            iatm, a(iatm)%name, ish, dot_product(shbeta(ish,iatm,:),matmul(invalpha,shbeta(ish,iatm,:)))
      end do
   end do

   call walltime(iwalltime2)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime2-iwalltime1

   if (itype==1) then !Output charges
      call outatmchg(10,charge(:))
   else if (itype==2) then !Generate radial density of every atom
      if (allocated(atmradnpt)) deallocate(atmradnpt)
      if (allocated(atmraddens)) deallocate(atmraddens)
      allocate(atmradnpt(ncenter),atmraddens(200,ncenter))
      do iatm=1,ncenter
         do ipt=1,200
            tmprho=0
            do ishell=1,mshell(iatm)
               alphaval11 = shalpha(ishell,iatm,1,1)
               alphaval22 = shalpha(ishell,iatm,2,2)
               alphaval33 = shalpha(ishell,iatm,3,3)
               alphaval13 = shalpha(ishell,iatm,1,3)
               alphaval12 = shalpha(ishell,iatm,1,2)
               alphaval23 = shalpha(ishell,iatm,2,3)
               alphaval31 = alphaval13
               alphaval21 = alphaval12
               alphaval32 = alphaval23
               det =0
               det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
               g=0
               g =alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
               shpopnew(ishell,iatm) = shpopnew(ishell,iatm) + tmpden*rho0sh(ishell,iatm)/rho0 !Eq. 18 of MBIS paper
               tmprho = tmprho +  shpop(ishell,iatm)*(dsqrt(det))/(8*pi)*exp(-dsqrt(g))
            end do
            atmraddens(ipt,iatm)=tmprho
            if (tmprho<1D-8) then !Electron density truncation
               atmradnpt(iatm)=ipt
               exit
            end if
         end do
      end do
      write(*,*) "Construction of MBIS atomic spaces has been finished!"
   end if

!frj generate exact results for printing and for later possible constrained MBIS
   call calc_multipole_frj(.false.,moldipol,molquad,moloct,molhex)
! calculate traceless form for printing purposes
!       Stone/Buckingham style traceless
   molquadt = 3.0d0*molquad
   trace = molquad(1) + molquad(4) + molquad(6)
   molquadt(1) = molquadt(1) - trace
   molquadt(4) = molquadt(4) - trace
   molquadt(6) = molquadt(6) - trace
   molquadt = molquadt/2.0d0

   moloctt  = 5.0d0*moloct
   tracex = moloct(1) + moloct(4) + moloct(6)
   tracey = moloct(2) + moloct(7) + moloct(9)
   tracez = moloct(3) + moloct(8) + moloct(10)
   moloctt(1)  = moloctt(1)  - 3.0d0*tracex
   moloctt(2)  = moloctt(2)  - tracey
   moloctt(3)  = moloctt(3)  - tracez
   moloctt(4)  = moloctt(4)  - tracex
   moloctt(6)  = moloctt(6)  - tracex
   moloctt(7)  = moloctt(7)  - 3.0d0*tracey
   moloctt(8)  = moloctt(8)  - tracez
   moloctt(9)  = moloctt(9)  - tracey
   moloctt(10) = moloctt(10) - 3.0d0*tracez
   moloctt  = moloctt/2.0d0

   molhext = 35.0d0*molhex
   trace   = molhex(1) + molhex(11) + molhex(15)
   trace   = trace + 2.0d0*( molhex(4) + molhex(6) + molhex(13) )
   tracexx = molhex(1) + molhex(4)  + molhex(6)
   tracexy = molhex(2) + molhex(7)  + molhex(9)
   tracexz = molhex(3) + molhex(8)  + molhex(10)
   traceyy = molhex(4) + molhex(11) + molhex(13)
   traceyz = molhex(5) + molhex(12) + molhex(14)
   tracezz = molhex(6) + molhex(13) + molhex(15)
   molhext(1)  = molhext(1)  - 30.0d0*tracexx + 3.0d0*trace
   molhext(2)  = molhext(2)  - 15.0d0*tracexy
   molhext(3)  = molhext(3)  - 15.0d0*tracexz
   molhext(4)  = molhext(4)  -  5.0d0*(tracexx + traceyy) + trace
   molhext(5)  = molhext(5)  -  5.0d0*traceyz
   molhext(6)  = molhext(6)  -  5.0d0*(tracexx + tracezz) + trace
   molhext(7)  = molhext(7)  - 15.0d0*tracexy
   molhext(8)  = molhext(8)  -  5.0d0*tracexz
   molhext(9)  = molhext(9)  -  5.0d0*tracexy
   molhext(10) = molhext(10) - 15.0d0*tracexz
   molhext(11) = molhext(11) - 30.0d0*traceyy + 3.0d0*trace
   molhext(12) = molhext(12) - 15.0d0*traceyz
   molhext(13) = molhext(13) -  5.0d0*(traceyy + tracezz) + trace
   molhext(14) = molhext(14) - 15.0d0*traceyz
   molhext(15) = molhext(15) - 30.0d0*tracezz + 3.0d0*trace
   molhext = molhext/8.0d0

   write(*,*)
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo
   write(*,*)' '
   write(*,*)' MBIS multipole moments up to rank 4'
   write(*,*)' '
! frj condense to atomic and molecular quantities
   call condensempl(.true.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
! frj and possibly write to file
   call eoutatommpl(10,5,maxshell,mshell(:),shpop(:,:),shalpha(:,:,:,:),shbeta(:,:,:),shbeta_rot(:,:,:),achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:),dsinfo)


! frj proceed to determine constrained MBIS?
   write(*,*)' '
   write(*,"(a)") " Proceed to decompose with multipole constraints?"
   write(*,"(a)") "  0: No"
   write(*,"(a)") " 10: Constrain Molecular Dipole                                               by Atomic Charges"
   write(*,"(a)") " 20: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges"
   write(*,"(a)") " 21: Constrain Molecular Dipole, Traceless Quadrupole                         by Atomic Charges, Dipoles"
   write(*,"(a)") " 30: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges"
   write(*,"(a)") " 31: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles"
   write(*,"(a)") " 32: Constrain Molecular Dipole, Traceless Quadrupole, Octupole               by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 40: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges"
   write(*,"(a)") " 41: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles"
   write(*,"(a)") " 42: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles"
   write(*,"(a)") " 43: Constrain Molecular Dipole, Traceless Quadrupole, Octupole, Hexadecapole by Atomic Charges, Dipoles, Quadrupoles, Octupoles"
   read(*,*) itmp
   if (itmp.ne.10 .and. itmp.ne.20 .and. itmp.ne.21 .and. itmp.ne.30 .and. itmp.ne.31 .and. itmp.ne.32 .and. itmp.ne.40 .and.  itmp.ne.41 .and. itmp.ne.42 .and. itmp.ne.43) return
   lcdip=.false.
   lcquad=.false.
   ldquad=.false.
   lcoct=.false.
   ldoct=.false.
   lqoct=.false.
   lchex=.false.
   ldhex=.false.
   lqhex=.false.
   lohex=.false.

   if (itmp.eq.10 .or. itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)         lcdip  = .true.
   if (itmp.eq.20 .or. itmp.eq.30 .or. itmp.eq.40)                         lcquad = .true.
   if (itmp.eq.30 .or. itmp.eq.40)                                         lcoct  = .true.
   if (itmp.eq.40)                                                         lchex  = .true.

   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcdip  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         lcquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         lcoct  = .true.
   if (itmp.eq.41)                                                         lchex  = .true.
   if (itmp.eq.21 .or. itmp.eq.31 .or. itmp.eq.41)                         ldquad = .true.
   if (itmp.eq.31 .or. itmp.eq.41)                                         ldoct  = .true.
   if (itmp.eq.41)                                                         ldhex  = .true.

   if (itmp.eq.32 .or. itmp.eq.42)                                         lcdip  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lcoct  = .true.
   if (itmp.eq.42)                                                         lchex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldquad = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         ldoct  = .true.
   if (itmp.eq.42)                                                         ldhex  = .true.
   if (itmp.eq.32 .or. itmp.eq.42)                                         lqoct  = .true.
   if (itmp.eq.42)                                                         lqhex  = .true.

   if (itmp.eq.43)                                                         lcdip  = .true.
   if (itmp.eq.43)                                                         lcquad = .true.
   if (itmp.eq.43)                                                         lcoct  = .true.
   if (itmp.eq.43)                                                         lchex  = .true.
   if (itmp.eq.43)                                                         ldquad = .true.
   if (itmp.eq.43)                                                         ldoct  = .true.
   if (itmp.eq.43)                                                         ldhex  = .true.
   if (itmp.eq.43)                                                         lqoct  = .true.
   if (itmp.eq.43)                                                         lqhex  = .true.
   if (itmp.eq.43)                                                         lohex  = .true.

! determine effective dimension of constraints, this actually saves some time
   ndimcon = 0
   if (lcdip) ndimcon = ndimcon + 3
   if (lcquad .or. ldquad) ndimcon = ndimcon + 6
   if (lcoct .or. ldoct .or. lqoct) ndimcon = ndimcon + 10
   if (lchex .or. ldhex .or. lqhex .or. lohex) ndimcon = ndimcon + 15
!write(*,*)'ndimcon =',ndimcon

   write(*,"(a,3f9.4)")'Reference molecular dipole      ',(moldipol(i),i=1,3)
   write(*,"(a,6f9.4)")'Reference traceless quadrupole  ',(molquadt(i),i=1,6)
   write(*,"(a,10f9.3)")'Reference traceless octupole    ',(moloctt(i),i=1,10)
   write(*,"(a,15f9.2)")'Reference traceless hexadecapole',(molhext(i),i=1,15)
   write(*,*)' '

! determine number of constraints and warn the user of some likely constraint failures
! charge is always conserved:
   nconstr = 1
   if (lcdip) nconstr = nconstr + 3
   if (lcquad .or. ldquad) nconstr = nconstr + 5
   if (lcoct .or. ldoct .or. lqoct) nconstr = nconstr + 7
   if (lchex .or. ldhex .or. lqhex .or. lohex) nconstr = nconstr + 9
   nparam = ncenter
   if (ldquad .or. ldoct .or. ldhex) nparam = nparam + 3*ncenter
   if (lqoct .or. lqhex) nparam = nparam + 5*ncenter
   if (lohex) nparam = nparam + 7*ncenter
   write(*,"(a,i5)")' Number of constraints       = ',nconstr
   write(*,"(a,i5)")' Number of atomic parameters = ',nparam
   if (nconstr .gt. nparam) write(*,"(a)")' WARNING! More constraints than free atomic parameters!'

! for testing, the exact dipole and quadrupole can be replaced with the reconstructed, as this makes the atomic to molecular multipole contribution zero to within the numerical noise
!do i=1,3
!   moldipol(i)=mdip(i,3)
!enddo
!do i=1,6
!   molquad(i)=mquad(i,4)
!   molquadt(i)=mquadt(i,4)
!enddo
!write(*,"(a,3f15.8)")'Reconstru molecular dipole     moments',(moldipol(i),i=1,3)
!write(*,"(a,6f15.8)")'Reconstru molecular quadrupole moments',(molquad(i),i=1,6)
!write(*,"(a,6f15.8)")'Reconstru traceless quadrupole moments',(molquadt(i),i=1,6)

! frj   this version calculates the new NAi and sigmaAi parameters in each kappa iteration, but they are only used if the kappa iterations has converged
!       this avoids the construction of a separate grid integration for these parameters, when the kappa iterations has converged
!       thus, a slight increase in the computational cost for each kappa iteration, but saving a grid integration for updating NAi and sigmaAi
!       the computational cost appears slightly larger, but the code is cleaner
!
! reuse maxcyc as safeguard for parameter iteration, this should (hopefully) be an overestimate
! set a small number of fixed number of kappa iterations (10), this should converge fast
!       if not, it is probably better to update the MBIS parameters, rather than spend more time on converging the constraints
!       one could consider always only doing one kappa iteration before parameter update, but that requires change in the code logic to detect proper convergence
!       currently a couple of other criteria are used for deciding whether to abandon the kappa iteration in favor of MBIS update (see later)
! set convergence criteria for the atomic charges to be the user specified in the regular MBIS
! set the gkappa convergence to factor 2 lower, and introduce a maximum kappa step, smax, as a safeguard
   kappamax=10
   qconv = crit
   gconv = 0.5d0*crit
   smax  = 1.0d-1

! initialize the Lagrange multiplier as zero
   kappa = 0.0d0
! for testing numerical vs. analytical Jacobian, test non-zero kappa values
!kappa = 0.001d0

! initialize the old charges as the regular MBIS
   achgold=achg(1,:)

! initialize the q (charge) history, for deciding if the decomposition fails, likely due to insufficient grid
   qhist=0.0d0

! lmult turns on all multipole calculations when close to convergence, otherwise only the necessary are calculated
! lpmult monitors lmult from the previous macro iteration, an ugly hack to prevent multipoles not being calculated in some rare cases
   lmult=.false.
   lpmult=.false.

! the outer loop for updating the MBIS parameters when kappa has been updated to make the constraints zero
! for testing numerical vs. analytical Jacobian, only one iteration
   if (lnumjacobi) maxcyc=1
   do kpar=1,maxcyc
      lpmult=lmult

! initialize the gkappa history, for deciding if the constraints fail, likely due to insufficient grid
      ghist=0.0d0

! the inner loop for iterating kappa to fulfill the multipole constraints
! for testing numerical vs. analytical Jacobian, only one iteration, and assign numerical stepsize
      if (lnumjacobi) then
         kappamax=1
         gstep=1.0d-4!OBS RETTER FOR TESTING
         gtmp=0.0d0
      endif
      do ikappa=1,kappamax

! lnumjacobi: turn next 5 lines on for testing numerical vs. analytical Jacobian, this must be done manually
!do knum=0,ndimcon
!  do kkk=1,2
!    if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)-gstep
!    if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)+gstep
!    write(*,*)'progress',knum,kkk


! initiate the Jacobian
         jkappa = 0.0d0

! frj re-use code structure from the above MBIS iteration to calculate cMBIS
         shellchg  = 0.0d0
         shelldip  = 0.0d0
         shellquad = 0.0d0
         shelloct  = 0.0d0
         shellhex  = 0.0d0
         dsinfo    = 0.0d0
         shpopnew(:,:)=0 !New population of shells of various atoms
         shsignew(:,:,:,:)=0 !New sigma of shells of various atoms
         shalphanew(:,:,:,:)=0
         do iatm=1,ncenter
            gridatm%value=gridatmorg%value
            gridatm%x=gridatmorg%x+a(iatm)%x
            gridatm%y=gridatmorg%y+a(iatm)%y
            gridatm%z=gridatmorg%z+a(iatm)%z
            call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
            do ipt=1+iradcut*sphpot,ntotpot
               gx = gridatm(ipt)%x
               gy = gridatm(ipt)%y
               gz = gridatm(ipt)%z
               rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
               rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
               do jatm=1,ncenter
                  dx = gridatm(ipt)%x - a(jatm)%x
                  dy = gridatm(ipt)%y - a(jatm)%y
                  dz = gridatm(ipt)%z - a(jatm)%z
                  dis2 = dx*dx + dy*dy + dz*dz
                  if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible
                  dis=dsqrt(dis2)
                  do ishell=1,mshell(jatm)
                     alphaval11 = shalpha(ishell,jatm,1,1)
                     alphaval22 = shalpha(ishell,jatm,2,2)
                     alphaval33 = shalpha(ishell,jatm,3,3)
                     alphaval13 = shalpha(ishell,jatm,1,3)
                     alphaval12 = shalpha(ishell,jatm,1,2)
                     alphaval23 = shalpha(ishell,jatm,2,3)
                     alphaval31 = alphaval13
                     alphaval21 = alphaval12
                     alphaval32 = alphaval23
                     det =0.0d0
                     det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
                     g=0.0d0
                     g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz
                     if (abs(g)>100000) cycle

                     tmp = shpop(ishell,jatm)*dsqrt(det)/8/pi*exp(-dsqrt(g)) !Eq. 7 of MBIS paper
                     rho0sh(ishell,jatm) = tmp
                     rho0 = rho0 + tmp
                  end do
               end do

!               frj: construct the equivalent of rho0 for the re-weighting, this is the denominator for the atomic shell weights collected in wtatm
               wtatm=0.0d0
!               frj: the wa derivatives for the Jacobian collected in jtatm, first collect the numerator in the wa term
               jtatm=0.0d0
!               katm loop over all atoms A and constructs the nominator for the re-weighting
               do katm=1,ncenter
                  rxk = a(katm)%x
                  ryk = a(katm)%y
                  rzk = a(katm)%z
                  dgkx = gx - rxk
                  dgky = gy - ryk
                  dgkz = gz - rzk
!                       calculate the multipole geometry functions for atom katm
                  call makehfunc(rxk,ryk,rzk,dgkx,dgky,dgkz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hkfunc)

                  do kshell=1,mshell(katm)
                     wtmp = 0.0d0
!                               jatm loop to collect the contribtions from all the other atoms in terms of distance
                     do jatm=1,ncenter
                        rxj = a(jatm)%x
                        ryj = a(jatm)%y
                        rzj = a(jatm)%z
                        dgjx = gx - rxj
                        dgjy = gy - ryj
                        dgjz = gz - rzj
!                                       calculate the multipole geometry functions for atom jatm
                        call makehfunc(rxj,ryj,rzj,dgjx,dgjy,dgjz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hjfunc)
!                                       charge-dipole term
                        dtmp = 0.0d0
                        if (lcdip) then
                           do i=1,3
                              dtmp = dtmp + kappa(i)*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                           enddo
                        end if
!                                       charge-quadrupole term
                        qtmp = 0.0d0
                        if (lcquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                           enddo
                        end if
!                                       dipole-quadrupole term
                        if (ldquad) then
                           do i=1,6
                              qtmp = qtmp + kappa(3+i)*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                           enddo
                        end if
!                                       charge-octupole term
                        otmp = 0.0d0
                        if (lcoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                           enddo
                        end if
!                                       dipole-octupole term
                        if (ldoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                           enddo
                        end if
!                                       quadrupole-octupole term
                        if (lqoct) then
                           do i=1,10
                              otmp = otmp + kappa(9+i)*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                           enddo
                        end if
!                                       charge-hexadecapole term
                        htmp = 0.0d0
                        if (lchex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                           enddo
                        end if
!                                       dipole-hexadecapole term
                        if (ldhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                           enddo
                        end if
!                                       quadrupole-hexadecapole term
                        if (lqhex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                           enddo
                        end if
!                                       octupole-hexadecapole term
                        if (lohex) then
                           do i=1,15
                              htmp = htmp + kappa(19+i)*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                           enddo
                        end if
                        xtmp = exp(dtmp+qtmp+otmp+htmp)
                        do ishell=1,mshell(jatm)
                           tmp = rho0sh(ishell,jatm)
                           wtmp = wtmp + xtmp*tmp
                           if (jatm.ne.katm) then
!                                                   charge-dipole term
                              if (lcdip) then
                                 do i=1,3
                                    jtatm(i,kshell,katm) = jtatm(i,kshell,katm) + xtmp*tmp*( hkfunc(1,1,i)-hjfunc(1,1,i) )
                                 enddo
                              end if
!                                                   charge-quadrupole term
                              if (lcquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(1,2,i)-hjfunc(1,2,i) )
                                 enddo
                              end if
!                                                   dipole-quadrupole term
                              if (ldquad) then
                                 do i=1,6
                                    jtatm(3+i,kshell,katm) = jtatm(3+i,kshell,katm) + xtmp*tmp*( hkfunc(2,2,i)-hjfunc(2,2,i) )
                                 enddo
                              end if
!                                                   charge-octupole term
                              if (lcoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(1,3,i)-hjfunc(1,3,i) )
                                 enddo
                              end if
!                                                   dipole-octupole term
                              if (ldoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(2,3,i)-hjfunc(2,3,i) )
                                 enddo
                              end if
!                                                   quadrupole-octupole term
                              if (lqoct) then
                                 do i=1,10
                                    jtatm(9+i,kshell,katm) = jtatm(9+i,kshell,katm) + xtmp*tmp*( hkfunc(3,3,i)-hjfunc(3,3,i) )
                                 enddo
                              end if
!                                                   charge-hexdecapole term
                              if (lchex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(1,4,i)-hjfunc(1,4,i) )
                                 enddo
                              end if
!                                                   dipole-hexdecapole term
                              if (ldhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(2,4,i)-hjfunc(2,4,i) )
                                 enddo
                              end if
!                                                   quadrupole-hexdecapole term
                              if (lqhex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(3,4,i)-hjfunc(3,4,i) )
                                 enddo
                              end if
!                                                   octupole-hexdecapole term
                              if (lohex) then
                                 do i=1,15
                                    jtatm(19+i,kshell,katm) = jtatm(19+i,kshell,katm) + xtmp*tmp*( hkfunc(4,4,i)-hjfunc(4,4,i) )
                                 enddo
                              end if
                           end if
                        end do
                     end do
!                               denominator complete
                     wtatm(kshell,katm) = wtmp
!                               now complete the wa derivatives, note the minus sign
                     rtmp = rho0sh(kshell,katm)
!                               wtmp should always be close to 1, but safeguarding anyway....
                     if (wtmp.gt.eps) then
                        do i=1,ndimcon
                           jtatm(i,kshell,katm) = -jtatm(i,kshell,katm)*rtmp/(wtmp**2)
                        end do
                     end if
                  end do
               end do
!               jtatm now has the dwa/dkappa derivative

!               Accumulate contribution of this integration grid to density contribution
!               calculate the shell atomic multipole moments to be used for the g-functions
               tmpden = tmpdens(ipt,iatm)
!               keep rho0 as the deciding cutoff factor, this should be safe
               if (rho0>0.and.tmpden>eps) then
                  do jatm=1,ncenter
                     gx = gridatm(ipt)%x
                     gy = gridatm(ipt)%y
                     gz = gridatm(ipt)%z
                     rx = a(jatm)%x
                     ry = a(jatm)%y
                     rz = a(jatm)%z
                     dx = gx-rx
                     dy = gy-ry
                     dz = gz-rz
!                               calculate multipole geometry functions
                     call makehfunc(rx,ry,rz,dx,dy,dz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hhfunc)
!
                     dis2 = dx*dx + dy*dy + dz*dz
                     if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested showed that this reduce cost nearly half, while accuracy lost is negligible (<0.0004)
                     dis=dsqrt(dis2)
                     dstmp  = 0.0d0
                     do ishell=1,mshell(jatm)
                        shpopnew(ishell,jatm) = shpopnew(ishell,jatm) + tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm) !Eq. 18 of MBIS paper

                        alphaval11 = shalpha(ishell,jatm,1,1)
                        alphaval22 = shalpha(ishell,jatm,2,2)
                        alphaval33 = shalpha(ishell,jatm,3,3)
                        alphaval13 = shalpha(ishell,jatm,1,3)
                        alphaval12 = shalpha(ishell,jatm,1,2)
                        alphaval23 = shalpha(ishell,jatm,2,3)

                        g=alphaval11*dx*dx+alphaval22*dy*dy+alphaval33*dz*dz+2*alphaval12*dx*dy+2*alphaval13*dx*dz+2*alphaval23*dy*dz

                        if(abs(dsqrt(g))<1.0d-8) cycle

                        shsignew(ishell,jatm,1,1) = shsignew(ishell,jatm,1,1) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dx)/(dsqrt(g)) !Integral part of Eq. 19 of MBIS paper
                        shsignew(ishell,jatm,2,2) = shsignew(ishell,jatm,2,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,3,3) = shsignew(ishell,jatm,3,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dz*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,1,2) = shsignew(ishell,jatm,1,2) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dy)/(dsqrt(g))
                        shsignew(ishell,jatm,1,3) = shsignew(ishell,jatm,1,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dx*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,3) = shsignew(ishell,jatm,2,3) + tmpden*rho0sh(ishell,jatm)/rho0*(dy*dz)/(dsqrt(g))
                        shsignew(ishell,jatm,2,1) = shsignew(ishell,jatm,1,2)
                        shsignew(ishell,jatm,3,1) = shsignew(ishell,jatm,1,3)
                        shsignew(ishell,jatm,3,2) = shsignew(ishell,jatm,2,3)
                        dstmp = dstmp + rho0sh(ishell,jatm)
                        wtmp = tmpden*rho0sh(ishell,jatm)/wtatm(ishell,jatm)
                        shellchg(ishell,jatm) = shellchg(ishell,jatm) + wtmp
! frj: lmult only calculates the necessary multipoles, except when close to convergence
                        call makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,shelldip,shellquad,shelloct,shellhex)

!                                       the Jacobian, the h function to be multiplied with the dwa/dkappa derivative
                        do i=1,ndimcon
                           rr = 0.0d0
!                                          charge-dipole term
                           if (lcdip) then
                              if (i.ge.1 .and. i.le.3) rr = rr + hhfunc(1,1,i)
                           end if
!                                          charge-quadrupole term
                           if (lcquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(1,2,i-3)
                           end if
!                                          dipole-quadrupole term
                           if (ldquad) then
                              if (i.ge.4 .and. i.le.9) rr = rr + hhfunc(2,2,i-3)
                           end if
!                                          charge-octupole term
                           if (lcoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(1,3,i-9)
                           end if
!                                          dipole-octupole term
                           if (ldoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(2,3,i-9)
                           end if
!                                          quadrupole-octupole term
                           if (lqoct) then
                              if (i.ge.10 .and. i.le.19) rr = rr + hhfunc(3,3,i-9)
                           end if
!                                          charge-hexdecapole term
                           if (lchex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(1,4,i-19)
                           end if
!                                          dipole-hexdecapole term
                           if (ldhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(2,4,i-19)
                           end if
!                                          quadrupole-hexdecapole term
                           if (lqhex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(3,4,i-19)
                           end if
!                                          octupole-hexdecapole term
                           if (lohex) then
                              if (i.ge.20 .and. i.le.34) rr = rr + hhfunc(4,4,i-19)
                           end if
                           do j=1,ndimcon
                              jkappa(i,j) = jkappa(i,j) + rr*jtatm(j,ishell,jatm)*tmpden
                           end do
                        end do
                     end do
                     if (dstmp.gt.1.0d-10) then
                        rho1   = tmpden*dstmp/rho0
                        rho2   = dstmp*gridatm(ipt)%value*beckeweigrid(ipt)
                        dsinfo = dsinfo + rho1*log(rho1/rho2)
                     endif
                  end do
               end if
            end do
         end do
!write(*,*)' dSInfo = ',dsinfo

!frj condense shell contributions to atomic and molecular quantities
         call condensempl(.false.,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
!
         if (kpar.eq.1 .and. ikappa.eq.1 .and. .not.lnumjacobi) then
            write(*,"(a,f12.6)")' Atomic charge        convergence = ',qconv
            write(*,"(a,f12.6)")' Multipole constraint convergence = ',gconv
            write(*,"(a,f12.6)")' Kappa step max                   = ',smax
            write(*,*)' '
            write(*,"(a)")'  MBIS kappa   gnorm       dCmax'
         end if
!frj calculate the g-functions: the errors in the multipole components
!       the error is relative to the sum of atomic multipoles included
!       test for convergence
         lgconv=.true.
         g1norm = 0.0d0
         g2norm = 0.0d0
         g3norm = 0.0d0
         g4norm = 0.0d0
         gkappa = 0.0d0
         if (lcdip) then
            do i=1,3
               tmp = moldipol(i) - mdip(i,1)
               gkappa(i) = tmp
               g1norm = g1norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcquad .or. ldquad) then
            do i=1,6
               if (ldquad) then
                  tmp = molquadt(i) - (mquadt(i,1) + mquadt(i,2))
               else
                  tmp = molquadt(i) - (mquadt(i,1))
               end if
               gkappa(i+3) = tmp
               g2norm = g2norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lcoct .or. ldoct .or. lqoct) then
            do i=1,10
               if (lqoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2) + moctt(i,3))
               else if (ldoct) then
                  tmp = moloctt(i) - (moctt(i,1) + moctt(i,2))
               else if (lcoct) then
                  tmp = moloctt(i) - (moctt(i,1))
               end if
               gkappa(i+9) = tmp
               g3norm = g3norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         if (lchex .or. ldhex .or. lqhex .or. lohex) then
            do i=1,15
               if (lohex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3) + mhext(i,4))
               else if (lqhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2) + mhext(i,3))
               else if (ldhex) then
                  tmp = molhext(i) - (mhext(i,1) + mhext(i,2))
               else if (lchex) then
                  tmp = molhext(i) - (mhext(i,1))
               end if
               gkappa(i+19) = tmp
               g4norm = g4norm + abs(tmp)
               if (abs(tmp).gt.gconv) lgconv=.false.
            end do
         end if
         g1norm = g1norm/3.0d0
         g2norm = g2norm/6.0d0
         g3norm = g3norm/10.0d0
         g4norm = g4norm/15.0d0

! the next section turned for testing numerical vs. analytical Jacobian
         if (lnumjacobi) then
            if (knum.gt.0) then
               do j=1,ndimcon
                  gtmp(kkk,knum,j)=gkappa(j)
               enddo
            endif
            if (knum.gt.0 .and. kkk.eq.1)kappa(knum)=kappa(knum)+gstep
            if (knum.gt.0 .and. kkk.eq.2)kappa(knum)=kappa(knum)-gstep
            if (knum.eq.0 .and. kkk.eq.1) then
               jsave=jkappa
               write(*,*)'jkappa anal'
               do i=1,ndimcon
                  write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
               enddo
            endif
         endif

! lnumjacobi: turn on the next two lines that closes the numerical loop, must be turned on manually
!  enddo
!enddo

         if (lnumjacobi) then
            write(*,*)'jkappa num'
            do i=1,ndimcon
               do j=1,ndimcon
                  xxx(j,i)=(gtmp(2,i,j)-gtmp(1,i,j))/(2.0d0*gstep)
               enddo
            enddo
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,(xxx(i,j),j=1,ndimcon)
            enddo
            write(*,*)'jkappa anal-num'
            do i=1,ndimcon
               write(*,"(i5,34f8.3)")i,((jsave(i,j)-xxx(i,j)),j=1,ndimcon)
            enddo
            itmp = 0
            jtmp = 0
            tmpm = 0.0d0
            itmpa = 0
            jtmpa = 0
            tmpma = 0.0d0
            do i=1,ndimcon
               do j=1,ndimcon
                  tmp = abs(jsave(i,j)-xxx(i,j))
                  if (tmp.gt.tmpm) then
                     itmp=i
                     jtmp=j
                     tmpm=tmp
                  endif
                  tmp = abs(jsave(i,j)-jsave(j,i))
                  if (tmp.gt.tmpma) then
                     itmpa=i
                     jtmpa=j
                     tmpma=tmp
                  endif
               enddo
            enddo
            write(*,*)'max diff =',tmpm,itmp,jtmp
            write(*,*)'max asym =',tmpma,itmpa,jtmpa
         endif
!end num Jacobian


! max change in atomic charges for printing
         dCmax=maxval(abs(achg(1,:)-achgold(:)))

! print info in the current MBIS-kappa iteration
         if (lcdip                                 ) write(*,"(2i5,2f12.6,5x,a,15f12.6)")kpar,ikappa,g1norm,dCmax,'kappa dip :',(kappa(i),i=1,3)
         if (lcquad .or. ldquad                    ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g2norm,'kappa quad:',(kappa(i),i=4,9)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g3norm,'kappa oct :',(kappa(i),i=10,15)
         if (lcoct .or. ldoct .or. lqoct           ) write(*,"(74x,15f12.6)")(kappa(i),i=16,19)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(2i5,1f12.6,17x,a,15f12.6)")kpar,ikappa,g4norm,'kappa hex :',(kappa(i),i=20,27)
         if (lchex .or. ldhex .or. lqhex .or. lohex) write(*,"(62x,15f12.6)")(kappa(i),i=28,34)

         if (lgconv) then
!   write(*,"(a,f12.6)")' All multipole constraints converged to within',gconv
            goto 900
         endif

! solve for the next kappa
! this, in principle, could be done by a call to pseudoinverse, but this employs a fixed 10^-10 criteria for small being zero,
!       and grid noise may lead to zero singular values being larger than that.
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jkappa(i,j),j=1,ndimcon)
!enddo

         call SVDmat(1,jkappa,umat,vmat,sigma,info)
         if (info.ne.0) then
            write(*,*)'WARNING! SVD of Jacobian failed'
         endif
!write(*,"(a,34d15.4)")'SVD sigma',(sigma(j),j=1,ndimcon)

! in the absence of symmetry there should be nconstraint-1 (charge conservation is always in place) non-zero eigenvalues,
!       but some of the rest could be non-zero due to grid noise from the traceless conditions, and some of the non-zero could be zero due to symmetry
! use a conservative svdcut criteria for deciding when small is zero, and make sure the gap position is valid...
         svdcut=1.0d-3
         ntmp=0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) ntmp=ntmp+1
         enddo
! if only dipole constraint, then there should be no a priori zero eigenvalues, and thus ntmp = ndimcon
         if (ntmp.lt.ndimcon) then
            tmp1 = sigma(ntmp)
            tmp2 = sigma(ntmp+1)
            tmp3 = 1.0d9
            if (abs(tmp2).gt.1.0d-12) tmp3=abs(tmp1/tmp2)
!       add a warning if no clear eigenvalue gap
            if (tmp3 .lt. 1.0d2) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: no clear eigenvalue gap'
               write(*,"(a)")' either the system has (near) symmetry or grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            end if
            if (ntmp.gt.nconstr-1) then
               write(*,"(a)")' WARNING! Jacobian pseudoinverse: more non-zero than constraints'
               write(*,"(a)")' the grid accuracy is questionable'
               write(*,"(a,34d12.4)")'SVD non-zero eigenvalues',(sigma(j),j=1,ntmp)
               write(*,"(a,34d12.4)")'SVD     zero eigenvalues',(sigma(j),j=ntmp+1,ndimcon)
            endif
!       enforce constraint eigenvalues to be zero
            do j=ntmp+1,ndimcon
               sigma(j) = 0.0d0
            end do
         endif
! we have explicit forced eigenvalues to zero, but keep svdcut just for good measure
         xmat=0.0d0
         do i=1,ndimcon
            if (abs(sigma(i)).gt.svdcut) xmat(i,i)=1.0d0/sigma(i)
         enddo
         jinv=matmul(matmul(vmat,xmat),transpose(umat))
!do i=1,ndimcon
!        write(*,"(i5,34f8.3)")i,(jinv(i,j),j=1,ndimcon)
!enddo



! calculate the step and update kappa
         sums=0.0d0
         do i=1,ndimcon
            tmp = 0.0d0
            do j=1,ndimcon
               tmp = tmp +jinv(i,j)*gkappa(j)
            enddo
!   write(*,"(a,i5,f12.6)")' step',i,-tmp
            step(i) = -tmp
            sums=sums+tmp*tmp
         enddo
         sums=dsqrt(sums)
!write(*,*)' step length',sums
         if (sums.gt.smax) then
            write(*,"(a,f12.6,a,f12.6)")' step',sums,' scaled down to',smax
!  write(*,*)sums
            sums=smax/sums
            step = sums*step
         endif

         tmpg1=g1norm
         tmpg2=g2norm
         tmpg3=g3norm
         tmpg4=g4norm
         if (.not.lcdip)  tmpg1=0.0d0
         if (.not.lcquad .and. .not.ldquad) tmpg2=0.0d0
         if (.not.lcoct .and. .not.ldoct .and. .not.lqoct) tmpg3=0.0d0
         if (.not.lchex .and. .not.ldhex .and. .not.lqhex .and. .not.lohex) tmpg4=0.0d0
         tmpg = tmpg1 + tmpg2 + tmpg3 + tmpg4
         ghist(ikappa)=tmpg

! frj: try to decide whether it is better to proceed to update the MBIS, than spending more time on the kappa...
         lgmon=.true.
         lgstuck=.false.
         if (ikappa.ge.3) then
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
            igmon=0
            do i=1,ikappa-1
               tmp = ghist(i)/ghist(i+1)
               if (tmp.lt.1.0d0) igmon=igmon+1
            end do
            if (igmon.ge.1) lgmon=.false.
!       if the last 3 iterations have made little progress, then it is stuck ...
            ghmax=0.0d0
            gsum =0.0d0
            do i=ikappa-2,ikappa
               tmp = ghist(i)
               if (tmp.gt.ghmax) ghmax=tmp
               gsum = gsum + tmp
            end do
            aveg = gsum/3.0d0
!       be more patient if close to convergence, indicated by lmult=.true.
            if (.not.lmult .and. ghmax.lt.2.0d0*aveg) lgstuck=.true.
            if (lmult .and. ghmax.lt.1.5d0*aveg) lgstuck=.true.
         end if

!write(*,*)'lgconv,lgmon,lgstuck',ikappa,lgconv,lgmon,lgstuck

         if (lgstuck .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' little g-improvements last 3 steps, proceeding to update MBIS parameters'
            goto 900
         end if

         if (tmpg.lt.2.0d0*gconv .and. .not.lgmon) then
            write(*,"(a,f12.6,a)")' g-norm is less than ',2.0d0*gconv,' and little improvements, proceeding to update MBIS parameters'
            goto 900
         end if

         if (ikappa.eq.kappamax) then
            write(*,"(a,i5,a)")' Failure to converge multipole constraints in iterations',kappamax,'   proceeding to update MBIS parameters'
            goto 900
         end if

         kappa = kappa + step

! end ikappa iterations
      end do

900   continue
!Include prefix part of Eq. 19 of MBIS paper
      do iatm=1,ncenter
         do ish=1,mshell(iatm)
            alphaval11 = shsignew(ish,iatm,1,1)
            alphaval22 = shsignew(ish,iatm,2,2)
            alphaval33 = shsignew(ish,iatm,3,3)
            alphaval13 = shsignew(ish,iatm,1,3)
            alphaval12 = shsignew(ish,iatm,1,2)
            alphaval23 = shsignew(ish,iatm,2,3)

            det =0
            det=alphaval11*alphaval22*alphaval33-alphaval11*alphaval23*alphaval23-alphaval22*alphaval13*alphaval13-alphaval33*alphaval12*alphaval12 +2*alphaval12*alphaval13*alphaval23
            ! write(*,*) "det=", det

            if (abs(det)<1.0d-10) cycle

            shalphanew(ish,iatm,1,1)=1.0d0/det * (shsignew(ish,iatm,2,2)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,2,3)*shsignew(ish,iatm,2,3))
            shalphanew(ish,iatm,2,2)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,3,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,3))
            shalphanew(ish,iatm,3,3)=1.0d0/det * (shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,2)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,2,1))
            shalphanew(ish,iatm,1,2)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,2,1)*shsignew(ish,iatm,3,3) )
            shalphanew(ish,iatm,1,3)=1.0d0/det * (shsignew(ish,iatm,1,2)*shsignew(ish,iatm,2,3)-shsignew(ish,iatm,1,3)*shsignew(ish,iatm,2,2) )
            shalphanew(ish,iatm,2,3)=1.0d0/det * (shsignew(ish,iatm,1,3)*shsignew(ish,iatm,1,2)-shsignew(ish,iatm,1,1)*shsignew(ish,iatm,2,3) )
            shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,1,3)
            shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)
            shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,1,2)

            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,1)=shalphanew(ish,iatm,1,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,2)=shalphanew(ish,iatm,2,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,3)=shalphanew(ish,iatm,3,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,2)=shalphanew(ish,iatm,1,2)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,1,3)=shalphanew(ish,iatm,1,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,3)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,2,1)=shalphanew(ish,iatm,2,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,1)=shalphanew(ish,iatm,3,1)*(shpopnew(ish,iatm))
            if (shpopnew(ish,iatm)>0) shalphanew(ish,iatm,3,2)=shalphanew(ish,iatm,2,3)*(shpopnew(ish,iatm))

         end do
      end do

!   update MBIS parameters and go for new kappa iteration
      shpop(:,:)=shpopnew(:,:)
      shalpha(:,:,:,:)=shalphanew(:,:,:,:)

      dCmax=maxval(abs(achg(1,:)-achgold(:)))
      lqconv=.false.
      if (dCmax.lt.qconv) lqconv=.true.

! turn on full multipole calculation if approaching convergence
      if (dCmax.lt.10.0d0*qconv) lmult=.true.
! be careful if tight convergence has been requested
      if (dCmax.lt.1.0d-4) lmult=.true.
! if lmult for some reason has not been turned on, but lqconv is true, reset it to go for one more cycle
      if (lqconv .and. .not.lmult) then
         lqconv=.false.
         lmult=.true.
      endif
! if lpmult is false, then all appears good, but no multipoles have been calculated, reset and go for one more cycle
      if (lqconv .and. lmult .and. .not.lpmult) then
         lqconv=.false.
         lmult=.true.
      endif

      tmpg = g1norm + g2norm + g3norm + g4norm

! try to decide from the history whether the decomposion is stuck due to insufficient numerical accuracy
! if less than 10 iterations, then just collect the information
! if more than 10 iterations, and nothing has changed for the last 10 iterations, make the decission to quit
! nothing is here defined as q is not converged, no monotonic convergence, and ratio of max to ave values is less than 3
      lqmon=.true.
      lqstuck=.false.
      lquit=.false.
      if (kpar.le.10) then
         qhist(kpar)=dCmax
      else
         do i=1,9
            qhist(i)=qhist(i+1)
         end do
         qhist(10)=dCmax
         qhmax=maxval(qhist(:))
         aveq = sum(qhist(:))/size(qhist(:))
         if (qhmax.lt.3.0d0*aveq) lqstuck=.true.
!       if the convergence is still mostly monotomic decreasing, there is still hope ...
         iqmon=0
         do i=1,9
            tmp = qhist(i)/qhist(i+1)
            if (tmp.lt.1.0d0) iqmon=iqmon+1
         end do
         if (iqmon.ge.3) lqmon=.false.
      end if

!do i=1,10
!        write(*,"(i5,2f12.6)")kpar-10+i,qhist(i),ghist(i)
!end do

!write(*,*)'lqconv,lqmon,lqstuck',lqconv,lqmon,lqstuck

      g1max = 0.0d0
      g2max = 0.0d0
      g3max = 0.0d0
      g4max = 0.0d0
      do i=1,3
         if (abs(gkappa(i)).gt.g1max) then
            g1max=abs(gkappa(i))
         endif
      enddo
      do i=4,9
         if (abs(gkappa(i)).gt.g2max) then
            g2max=abs(gkappa(i))
         endif
      enddo
      do i=10,19
         if (abs(gkappa(i)).gt.g3max) then
            g3max=abs(gkappa(i))
         endif
      enddo
      do i=20,34
         if (abs(gkappa(i)).gt.g4max) then
            g4max=abs(gkappa(i))
         endif
      enddo

      lgaconv=.true.
      if (g1norm.gt.gconv) lgaconv=.false.
      if (g2norm.gt.gconv) lgaconv=.false.
      if (g3norm.gt.gconv) lgaconv=.false.
      if (g4norm.gt.gconv) lgaconv=.false.

! now try to make decissions ...
      if (lqconv .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         goto 901
      end if
      if (lqconv .and. .not.lgconv .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  are converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if
      if (lqstuck .and. .not. lgmon .and. lgconv) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max are converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv)write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         lquit=.true.
      end if
      if (lqstuck .and. .not.lqmon .and. lgstuck .and. .not.lgmon) then
         write(*,"(a,2f12.6)")' All atomic charges  not converged to within',qconv,dCmax
         write(*,"(a,5f12.6)")' All constraints max not converged to within',gconv,g1max,g2max,g3max,g4max
         if(lgaconv) then
            write(*,"(a,5f12.6)")' All constraints ave are converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         else
            write(*,"(a,5f12.6)")' All constraints ave not converged to within',gconv,g1norm,g2norm,g3norm,g4norm
         endif
         lquit=.true.
      end if

      if (lquit) then
!        write(*,"(a,2f12.6)")' Very little C and G progress in the last 10 iterations'
!        do i=1,10
!                write(*,"(i5,2f12.6)")kpar-10+i,qhist(i),ghist(i)
!        end do
         write(*,"(a,2f12.6)")' Decomposition appears stuck, deciding to quit ...'
         write(*,"(a,2f12.6)")' Likely reason(s): insufficient grid accuracy or more constraints than atomic parameters'
         write(*,*)' '
         goto 901
      end if

      if (kpar.eq.maxcyc) then
         write(*,"(a,i5)")' Failure to converge atomic charges and constraints in iterations',maxcyc
         goto 901
      end if
      achgold=achg(1,:)
! end kpar loop for updating cMBIS parameters
   end do

901 continue

! output the final constrained results
   call eoutatommpl(10,4,maxshell,mshell(:),shpop(:,:),shalpha(:,:,:,:),shbeta(:,:,:),shbeta_rot(:,:,:),achg(:,:),adip(:,:),aquad(:,:),aquadt(:,:),aoct(:,:),aoctt(:,:),ahex(:,:),ahext(:,:),mchg,mdip(:,:),mquad(:,:),mquadt(:,:),moct(:,:),moctt(:,:),mhex(:,:),mhext(:,:),moldipol(:),molquad(:),molquadt(:),moloct(:),moloctt(:),molhex(:),molhext(:),dsinfo)
! make final check that the sum of NAi matches the QA
   do iatm=1,ncenter
      tmp = 0.0d0
      do ishell=1,mshell(iatm)
         tmp = tmp + shpop(ishell,iatm)
      end do
      electmp = a(iatm)%charge - achg(1,iatm)
      if (abs(tmp-electmp).gt.crit) then
         write(*,"(a,i5,3f12.6)") 'normalization problem?',iatm,tmp,electmp
      end if
   end do

   write(*,*)' '
   write(*,"(a,f15.8)")' MBIS dS-Info = ',dsinfo

   call walltime(iwalltime3)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime3-iwalltime2


end subroutine







subroutine condensempl(lprint,maxshell,mshell,shellchg,shelldip,shellquad,shelloct,shellhex,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
   use defvar
   use util
   logical lprint
   integer maxshell
   integer mshell(ncenter)
   real*8 shellchg(maxshell,ncenter), shelldip(3,maxshell,ncenter), shellquad(6,maxshell,ncenter)
   real*8 shelloct(10,maxshell,ncenter), shellhex(15,maxshell,ncenter)
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter)
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4), moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)

!       select whether to use raw (unormalized) or normalized charges
   inorm = 2
   if (lprint) then
      if (inorm.eq.1) write(*,"(a)")'  Using un-normalized charges in the reconstruction of molecular multipole moments'
      if (inorm.eq.2) write(*,"(a)")'  Using    normalized charges in the reconstruction of molecular multipole moments'
      write(*,*)' '
   end if

   achg  = 0.0d0
   adip  = 0.0d0
   aquad = 0.0d0
   aoct  = 0.0d0
   ahex  = 0.0d0
   do iatm=1,ncenter
      electmp = 0.0d0
      do ishell=1,mshell(iatm)
         electmp = electmp + shellchg(ishell,iatm)
         do k=1,3
            adip(k,iatm) = adip(k,iatm) - shelldip(k,ishell,iatm)
         end do
         do k=1,6
            aquad(k,iatm) = aquad(k,iatm) - shellquad(k,ishell,iatm)
         end do
         do k=1,10
            aoct(k,iatm) = aoct(k,iatm) - shelloct(k,ishell,iatm)
         end do
         do k=1,15
            ahex(k,iatm) = ahex(k,iatm) - shellhex(k,ishell,iatm)
         end do
      end do
      achg(1,iatm) = a(iatm)%charge - electmp
   end do
!       calculate normalized charges
   tsum1 = sum(achg(1,:))
   nsum = nint(tsum1)
   tchg = dble(nsum)
   tsum = tsum1 - tchg
   tsum = tsum/dble(ncenter)
   achg(2,:) = achg(1,:) - tsum
   tsum2 = sum(achg(2,:))

!        same in traceless form
!        Gaussian style definitions
!aquadt = aquad
!do iatm=1,ncenter
!        trace = aquad(1,iatm) + aquad(4,iatm) + aquad(6,iatm)
!        aquadt(1,iatm) = (3.0d0*aquad(1,iatm) - trace) / 3.0d0
!        aquadt(4,iatm) = (3.0d0*aquad(4,iatm) - trace) / 3.0d0
!        aquadt(6,iatm) = (3.0d0*aquad(6,iatm) - trace) / 3.0d0
!end do

!       Stone/Buckingham style traceless
   aquadt = 3.0d0*aquad
   do iatm=1,ncenter
      trace = aquad(1,iatm) + aquad(4,iatm) + aquad(6,iatm)
      aquadt(1,iatm) = aquadt(1,iatm) - trace
      aquadt(4,iatm) = aquadt(4,iatm) - trace
      aquadt(6,iatm) = aquadt(6,iatm) - trace
   end do
   aquadt = aquadt/2.0d0

   aoctt  = 5.0d0*aoct
   do iatm=1,ncenter
      tracex = aoct(1,iatm) + aoct(4,iatm) + aoct(6,iatm)
      tracey = aoct(2,iatm) + aoct(7,iatm) + aoct(9,iatm)
      tracez = aoct(3,iatm) + aoct(8,iatm) + aoct(10,iatm)
      aoctt(1,iatm)  = aoctt(1,iatm)  - 3.0d0*tracex
      aoctt(2,iatm)  = aoctt(2,iatm)  - tracey
      aoctt(3,iatm)  = aoctt(3,iatm)  - tracez
      aoctt(4,iatm)  = aoctt(4,iatm)  - tracex
      aoctt(6,iatm)  = aoctt(6,iatm)  - tracex
      aoctt(7,iatm)  = aoctt(7,iatm)  - 3.0d0*tracey
      aoctt(8,iatm)  = aoctt(8,iatm)  - tracez
      aoctt(9,iatm)  = aoctt(9,iatm)  - tracey
      aoctt(10,iatm) = aoctt(10,iatm) - 3.0d0*tracez
   end do
   aoctt  = aoctt/2.0d0

   ahext = 35.0d0*ahex
   do iatm=1,ncenter
      trace   = ahex(1,iatm) + ahex(11,iatm) + ahex(15,iatm)
      trace   = trace + 2.0d0*( ahex(4,iatm) + ahex(6,iatm) + ahex(13,iatm) )
      tracexx = ahex(1,iatm) + ahex(4,iatm)  + ahex(6,iatm)
      tracexy = ahex(2,iatm) + ahex(7,iatm)  + ahex(9,iatm)
      tracexz = ahex(3,iatm) + ahex(8,iatm)  + ahex(10,iatm)
      traceyy = ahex(4,iatm) + ahex(11,iatm) + ahex(13,iatm)
      traceyz = ahex(5,iatm) + ahex(12,iatm) + ahex(14,iatm)
      tracezz = ahex(6,iatm) + ahex(13,iatm) + ahex(15,iatm)
      ahext(1,iatm)  = ahext(1,iatm)  - 30.0d0*tracexx + 3.0d0*trace
      ahext(2,iatm)  = ahext(2,iatm)  - 15.0d0*tracexy
      ahext(3,iatm)  = ahext(3,iatm)  - 15.0d0*tracexz
      ahext(4,iatm)  = ahext(4,iatm)  -  5.0d0*(tracexx + traceyy) + trace
      ahext(5,iatm)  = ahext(5,iatm)  -  5.0d0*traceyz
      ahext(6,iatm)  = ahext(6,iatm)  -  5.0d0*(tracexx + tracezz) + trace
      ahext(7,iatm)  = ahext(7,iatm)  - 15.0d0*tracexy
      ahext(8,iatm)  = ahext(8,iatm)  -  5.0d0*tracexz
      ahext(9,iatm)  = ahext(9,iatm)  -  5.0d0*tracexy
      ahext(10,iatm) = ahext(10,iatm) - 15.0d0*tracexz
      ahext(11,iatm) = ahext(11,iatm) - 30.0d0*traceyy + 3.0d0*trace
      ahext(12,iatm) = ahext(12,iatm) - 15.0d0*traceyz
      ahext(13,iatm) = ahext(13,iatm) -  5.0d0*(traceyy + tracezz) + trace
      ahext(14,iatm) = ahext(14,iatm) - 15.0d0*traceyz
      ahext(15,iatm) = ahext(15,iatm) - 30.0d0*tracezz + 3.0d0*trace
   end do
   ahext = ahext/8.0d0

   if (lprint) then
      write(*,*)' Atomic charges, un-normalized, normalized, Ss being the sum'
      do iatm=1,ncenter
         write(*,"(a,2f15.8)")a(iatm)%name,achg(1,iatm),achg(2,iatm)
      end do
      write(*,"(a,2f15.8)")'Ss',tsum1,tsum2
      write(*,*)' Atomic dipoles, in order x, y, z'
      do iatm=1,ncenter
         write(*,"(a,3f15.8)")a(iatm)%name,(adip(j,iatm),j=1,3)
      end do
      write(*,*)' Atomic quadrupoles, Cartesian form, in order xx, xy, xz, yy, yz, zz'
      do iatm=1,ncenter
         write(*,"(a,6f15.8)")a(iatm)%name,(aquad(j,iatm),j=1,6)
      end do
      write(*,*)' Atomic quadrupoles, Traceless form'
      do iatm=1,ncenter
         write(*,"(a,6f15.8)")a(iatm)%name,(aquadt(j,iatm),j=1,6)
      end do
      write(*,"(a)")' Atomic octupoles, Cartesian form, in order: xxx, xxy, xxz, xyy, xyz, xzz, yyy, yyz, yzz, zzz'
      do iatm=1,ncenter
         write(*,"(a,10f10.4)") a(iatm)%name,(aoct(j,iatm),j=1,10)
      end do
      write(*,*)' Atomic octupoles, Traceless form'
      do iatm=1,ncenter
         write(*,"(a,10f10.4)") a(iatm)%name,(aoctt(j,iatm),j=1,10)
      end do
      write(*,"(a)")' Atomic hexadecapoles, Cartesian form, in order: xxxx, xxxy, xxxz, xxyy, xxyz, xxzz, xyyy, xyyz, xyzz, xzzz, yyyy, yyyz, yyzz, yzzz, zzzz'
      do iatm=1,ncenter
         write(*,"(a,15f10.4)") a(iatm)%name,(ahex(j,iatm),j=1,15)
      end do
      write(*,*)' Atomic hexadecapoles, Traceless form'
      do iatm=1,ncenter
         write(*,"(a,15f10.4)") a(iatm)%name,(ahext(j,iatm),j=1,15)
      end do
   end if
!
!  construct the molecular multipoles from the atomic ones
   mchg  = 0.d00
   mdip  = 0.d00
   mquad = 0.d00
   moct  = 0.d00
   mhex  = 0.d00
   do iatm=1,ncenter
      rax = a(iatm)%x
      ray = a(iatm)%y
      raz = a(iatm)%z
      raxx = rax*rax
      raxy = rax*ray
      raxz = rax*raz
      rayy = ray*ray
      rayz = ray*raz
      razz = raz*raz
      raxxx = raxx*rax
      raxxy = raxx*ray
      raxxz = raxx*raz
      raxyy = raxy*ray
      raxyz = raxy*raz
      raxzz = raxz*raz
      rayyy = rayy*ray
      rayyz = rayy*raz
      rayzz = rayz*raz
      razzz = razz*raz
      raxxxx = raxxx*rax
      raxxxy = raxxx*ray
      raxxxz = raxxx*raz
      raxxyy = raxxy*ray
      raxxyz = raxxy*raz
      raxxzz = raxxz*raz
      raxyyy = raxyy*ray
      raxyyz = raxyy*raz
      raxyzz = raxyz*raz
      raxzzz = raxzz*raz
      rayyyy = rayyy*ray
      rayyyz = rayyy*raz
      rayyzz = rayyz*raz
      rayzzz = rayzz*raz
      razzzz = razzz*raz

      tchg = achg(inorm,iatm)

      mchg = mchg + achg(inorm,iatm)

      mdip(1,1) = mdip(1,1) + tchg*rax
      mdip(2,1) = mdip(2,1) + tchg*ray
      mdip(3,1) = mdip(3,1) + tchg*raz
      mdip(1,2) = mdip(1,2) + adip(1,iatm)
      mdip(2,2) = mdip(2,2) + adip(2,iatm)
      mdip(3,2) = mdip(3,2) + adip(3,iatm)

      mquad(1,1) = mquad(1,1) + tchg*raxx
      mquad(2,1) = mquad(2,1) + tchg*raxy
      mquad(3,1) = mquad(3,1) + tchg*raxz
      mquad(4,1) = mquad(4,1) + tchg*rayy
      mquad(5,1) = mquad(5,1) + tchg*rayz
      mquad(6,1) = mquad(6,1) + tchg*razz
      mquad(1,2) = mquad(1,2) + adip(1,iatm)*rax + adip(1,iatm)*rax
      mquad(2,2) = mquad(2,2) + adip(1,iatm)*ray + adip(2,iatm)*rax
      mquad(3,2) = mquad(3,2) + adip(1,iatm)*raz + adip(3,iatm)*rax
      mquad(4,2) = mquad(4,2) + adip(2,iatm)*ray + adip(2,iatm)*ray
      mquad(5,2) = mquad(5,2) + adip(2,iatm)*raz + adip(3,iatm)*ray
      mquad(6,2) = mquad(6,2) + adip(3,iatm)*raz + adip(3,iatm)*raz
      mquad(1,3) = mquad(1,3) + aquad(1,iatm)
      mquad(2,3) = mquad(2,3) + aquad(2,iatm)
      mquad(3,3) = mquad(3,3) + aquad(3,iatm)
      mquad(4,3) = mquad(4,3) + aquad(4,iatm)
      mquad(5,3) = mquad(5,3) + aquad(5,iatm)
      mquad(6,3) = mquad(6,3) + aquad(6,iatm)

      moct(1,1)  = moct(1,1)  + tchg*raxxx
      moct(2,1)  = moct(2,1)  + tchg*raxxy
      moct(3,1)  = moct(3,1)  + tchg*raxxz
      moct(4,1)  = moct(4,1)  + tchg*raxyy
      moct(5,1)  = moct(5,1)  + tchg*raxyz
      moct(6,1)  = moct(6,1)  + tchg*raxzz
      moct(7,1)  = moct(7,1)  + tchg*rayyy
      moct(8,1)  = moct(8,1)  + tchg*rayyz
      moct(9,1)  = moct(9,1)  + tchg*rayzz
      moct(10,1) = moct(10,1) + tchg*razzz
      moct(1,2)  = moct(1,2)  + adip(1,iatm)*raxx + adip(1,iatm)*raxx + adip(1,iatm)*raxx
      moct(2,2)  = moct(2,2)  + adip(1,iatm)*raxy + adip(1,iatm)*raxy + adip(2,iatm)*raxx
      moct(3,2)  = moct(3,2)  + adip(1,iatm)*raxz + adip(1,iatm)*raxz + adip(3,iatm)*raxx
      moct(4,2)  = moct(4,2)  + adip(1,iatm)*rayy + adip(2,iatm)*raxy + adip(2,iatm)*raxy
      moct(5,2)  = moct(5,2)  + adip(1,iatm)*rayz + adip(2,iatm)*raxz + adip(3,iatm)*raxy
      moct(6,2)  = moct(6,2)  + adip(1,iatm)*razz + adip(3,iatm)*raxz + adip(3,iatm)*raxz
      moct(7,2)  = moct(7,2)  + adip(2,iatm)*rayy + adip(2,iatm)*rayy + adip(2,iatm)*rayy
      moct(8,2)  = moct(8,2)  + adip(2,iatm)*rayz + adip(2,iatm)*rayz + adip(3,iatm)*rayy
      moct(9,2)  = moct(9,2)  + adip(2,iatm)*razz + adip(3,iatm)*rayz + adip(3,iatm)*rayz
      moct(10,2) = moct(10,2) + adip(3,iatm)*razz + adip(3,iatm)*razz + adip(3,iatm)*razz
      moct(1,3)  = moct(1,3)  + aquad(1,iatm)*rax + aquad(1,iatm)*rax + aquad(1,iatm)*rax
      moct(2,3)  = moct(2,3)  + aquad(1,iatm)*ray + aquad(2,iatm)*rax + aquad(2,iatm)*rax
      moct(3,3)  = moct(3,3)  + aquad(1,iatm)*raz + aquad(3,iatm)*rax + aquad(3,iatm)*rax
      moct(4,3)  = moct(4,3)  + aquad(2,iatm)*ray + aquad(2,iatm)*ray + aquad(4,iatm)*rax
      moct(5,3)  = moct(5,3)  + aquad(2,iatm)*raz + aquad(3,iatm)*ray + aquad(5,iatm)*rax
      moct(6,3)  = moct(6,3)  + aquad(3,iatm)*raz + aquad(3,iatm)*raz + aquad(6,iatm)*rax
      moct(7,3)  = moct(7,3)  + aquad(4,iatm)*ray + aquad(4,iatm)*ray + aquad(4,iatm)*ray
      moct(8,3)  = moct(8,3)  + aquad(4,iatm)*raz + aquad(5,iatm)*ray + aquad(5,iatm)*ray
      moct(9,3)  = moct(9,3)  + aquad(5,iatm)*raz + aquad(5,iatm)*raz + aquad(6,iatm)*ray
      moct(10,3) = moct(10,3) + aquad(6,iatm)*raz + aquad(6,iatm)*raz + aquad(6,iatm)*raz
      moct(1,4)  = moct(1,4)  + aoct(1,iatm)
      moct(2,4)  = moct(2,4)  + aoct(2,iatm)
      moct(3,4)  = moct(3,4)  + aoct(3,iatm)
      moct(4,4)  = moct(4,4)  + aoct(4,iatm)
      moct(5,4)  = moct(5,4)  + aoct(5,iatm)
      moct(6,4)  = moct(6,4)  + aoct(6,iatm)
      moct(7,4)  = moct(7,4)  + aoct(7,iatm)
      moct(8,4)  = moct(8,4)  + aoct(8,iatm)
      moct(9,4)  = moct(9,4)  + aoct(9,iatm)
      moct(10,4) = moct(10,4) + aoct(10,iatm)

      mhex(1,1)  = mhex(1,1)  + tchg*raxxxx
      mhex(2,1)  = mhex(2,1)  + tchg*raxxxy
      mhex(3,1)  = mhex(3,1)  + tchg*raxxxz
      mhex(4,1)  = mhex(4,1)  + tchg*raxxyy
      mhex(5,1)  = mhex(5,1)  + tchg*raxxyz
      mhex(6,1)  = mhex(6,1)  + tchg*raxxzz
      mhex(7,1)  = mhex(7,1)  + tchg*raxyyy
      mhex(8,1)  = mhex(8,1)  + tchg*raxyyz
      mhex(9,1)  = mhex(9,1)  + tchg*raxyzz
      mhex(10,1) = mhex(10,1) + tchg*raxzzz
      mhex(11,1) = mhex(11,1) + tchg*rayyyy
      mhex(12,1) = mhex(12,1) + tchg*rayyyz
      mhex(13,1) = mhex(13,1) + tchg*rayyzz
      mhex(14,1) = mhex(14,1) + tchg*rayzzz
      mhex(15,1) = mhex(15,1) + tchg*razzzz
      mhex(1,2)  = mhex(1,2)  + adip(1,iatm)*raxxx + adip(1,iatm)*raxxx + adip(1,iatm)*raxxx + adip(1,iatm)*raxxx
      mhex(2,2)  = mhex(2,2)  + adip(1,iatm)*raxxy + adip(1,iatm)*raxxy + adip(1,iatm)*raxxy + adip(2,iatm)*raxxx
      mhex(3,2)  = mhex(3,2)  + adip(1,iatm)*raxxz + adip(1,iatm)*raxxz + adip(1,iatm)*raxxz + adip(3,iatm)*raxxx
      mhex(4,2)  = mhex(4,2)  + adip(1,iatm)*raxyy + adip(1,iatm)*raxyy + adip(2,iatm)*raxxy + adip(2,iatm)*raxxy
      mhex(5,2)  = mhex(5,2)  + adip(1,iatm)*raxyz + adip(1,iatm)*raxyz + adip(2,iatm)*raxxz + adip(3,iatm)*raxxy
      mhex(6,2)  = mhex(6,2)  + adip(1,iatm)*raxzz + adip(1,iatm)*raxzz + adip(3,iatm)*raxxz + adip(3,iatm)*raxxz
      mhex(7,2)  = mhex(7,2)  + adip(1,iatm)*rayyy + adip(2,iatm)*raxyy + adip(2,iatm)*raxyy + adip(2,iatm)*raxyy
      mhex(8,2)  = mhex(8,2)  + adip(1,iatm)*rayyz + adip(2,iatm)*raxyz + adip(2,iatm)*raxyz + adip(3,iatm)*raxyy
      mhex(9,2)  = mhex(9,2)  + adip(1,iatm)*rayzz + adip(2,iatm)*raxzz + adip(3,iatm)*raxyz + adip(3,iatm)*raxyz
      mhex(10,2) = mhex(10,2) + adip(1,iatm)*razzz + adip(3,iatm)*raxzz + adip(3,iatm)*raxzz + adip(3,iatm)*raxzz
      mhex(11,2) = mhex(11,2) + adip(2,iatm)*rayyy + adip(2,iatm)*rayyy + adip(2,iatm)*rayyy + adip(2,iatm)*rayyy
      mhex(12,2) = mhex(12,2) + adip(2,iatm)*rayyz + adip(2,iatm)*rayyz + adip(2,iatm)*rayyz + adip(3,iatm)*rayyy
      mhex(13,2) = mhex(13,2) + adip(2,iatm)*rayzz + adip(2,iatm)*rayzz + adip(3,iatm)*rayyz + adip(3,iatm)*rayyz
      mhex(14,2) = mhex(14,2) + adip(2,iatm)*razzz + adip(3,iatm)*rayzz + adip(3,iatm)*rayzz + adip(3,iatm)*rayzz
      mhex(15,2) = mhex(15,2) + adip(3,iatm)*razzz + adip(3,iatm)*razzz + adip(3,iatm)*razzz + adip(3,iatm)*razzz
      mhex(1,3)  = mhex(1,3)  + aquad(1,iatm)*raxx + aquad(1,iatm)*raxx + aquad(1,iatm)*raxx + aquad(1,iatm)*raxx + aquad(1,iatm)*raxx + aquad(1,iatm)*raxx
      mhex(2,3)  = mhex(2,3)  + aquad(1,iatm)*raxy + aquad(1,iatm)*raxy + aquad(1,iatm)*raxy + aquad(2,iatm)*raxx + aquad(2,iatm)*raxx + aquad(2,iatm)*raxx
      mhex(3,3)  = mhex(3,3)  + aquad(1,iatm)*raxz + aquad(1,iatm)*raxz + aquad(1,iatm)*raxz + aquad(3,iatm)*raxx + aquad(3,iatm)*raxx + aquad(3,iatm)*raxx
      mhex(4,3)  = mhex(4,3)  + aquad(1,iatm)*rayy + aquad(2,iatm)*raxy + aquad(2,iatm)*raxy + aquad(2,iatm)*raxy + aquad(2,iatm)*raxy + aquad(4,iatm)*raxx
      mhex(5,3)  = mhex(5,3)  + aquad(1,iatm)*rayz + aquad(2,iatm)*raxz + aquad(2,iatm)*raxz + aquad(3,iatm)*raxy + aquad(3,iatm)*raxy + aquad(5,iatm)*raxx
      mhex(6,3)  = mhex(6,3)  + aquad(1,iatm)*razz + aquad(3,iatm)*raxz + aquad(3,iatm)*raxz + aquad(3,iatm)*raxz + aquad(3,iatm)*raxz + aquad(6,iatm)*raxx
      mhex(7,3)  = mhex(7,3)  + aquad(2,iatm)*rayy + aquad(2,iatm)*rayy + aquad(2,iatm)*rayy + aquad(4,iatm)*raxy + aquad(4,iatm)*raxy + aquad(4,iatm)*raxy
      mhex(8,3)  = mhex(8,3)  + aquad(2,iatm)*rayz + aquad(2,iatm)*rayz + aquad(3,iatm)*rayy + aquad(4,iatm)*raxz + aquad(5,iatm)*raxy + aquad(5,iatm)*raxy
      mhex(9,3)  = mhex(9,3)  + aquad(2,iatm)*razz + aquad(3,iatm)*rayz + aquad(3,iatm)*rayz + aquad(5,iatm)*raxz + aquad(5,iatm)*raxz + aquad(6,iatm)*raxy
      mhex(10,3) = mhex(10,3) + aquad(3,iatm)*razz + aquad(3,iatm)*razz + aquad(3,iatm)*razz + aquad(6,iatm)*raxz + aquad(6,iatm)*raxz + aquad(6,iatm)*raxz
      mhex(11,3) = mhex(11,3) + aquad(4,iatm)*rayy + aquad(4,iatm)*rayy + aquad(4,iatm)*rayy + aquad(4,iatm)*rayy + aquad(4,iatm)*rayy + aquad(4,iatm)*rayy
      mhex(12,3) = mhex(12,3) + aquad(4,iatm)*rayz + aquad(4,iatm)*rayz + aquad(4,iatm)*rayz + aquad(5,iatm)*rayy + aquad(5,iatm)*rayy + aquad(5,iatm)*rayy
      mhex(13,3) = mhex(13,3) + aquad(4,iatm)*razz + aquad(5,iatm)*rayz + aquad(5,iatm)*rayz + aquad(5,iatm)*rayz + aquad(5,iatm)*rayz + aquad(6,iatm)*rayy
      mhex(14,3) = mhex(14,3) + aquad(5,iatm)*razz + aquad(5,iatm)*razz + aquad(5,iatm)*razz + aquad(6,iatm)*rayz + aquad(6,iatm)*rayz + aquad(6,iatm)*rayz
      mhex(15,3) = mhex(15,3) + aquad(6,iatm)*razz + aquad(6,iatm)*razz + aquad(6,iatm)*razz + aquad(6,iatm)*razz + aquad(6,iatm)*razz + aquad(6,iatm)*razz
      mhex(1,4)  = mhex(1,4)  + aoct(1,iatm)*rax + aoct(1,iatm)*rax + aoct(1,iatm)*rax + aoct(1,iatm)*rax
      mhex(2,4)  = mhex(2,4)  + aoct(1,iatm)*ray + aoct(2,iatm)*rax + aoct(2,iatm)*rax + aoct(2,iatm)*rax
      mhex(3,4)  = mhex(3,4)  + aoct(1,iatm)*raz + aoct(3,iatm)*rax + aoct(3,iatm)*rax + aoct(3,iatm)*rax
      mhex(4,4)  = mhex(4,4)  + aoct(2,iatm)*ray + aoct(2,iatm)*ray + aoct(4,iatm)*rax + aoct(4,iatm)*rax
      mhex(5,4)  = mhex(5,4)  + aoct(2,iatm)*raz + aoct(3,iatm)*ray + aoct(5,iatm)*rax + aoct(5,iatm)*rax
      mhex(6,4)  = mhex(6,4)  + aoct(3,iatm)*raz + aoct(3,iatm)*raz + aoct(6,iatm)*rax + aoct(6,iatm)*rax
      mhex(7,4)  = mhex(7,4)  + aoct(4,iatm)*ray + aoct(4,iatm)*ray + aoct(4,iatm)*ray + aoct(7,iatm)*rax
      mhex(8,4)  = mhex(8,4)  + aoct(4,iatm)*raz + aoct(5,iatm)*ray + aoct(5,iatm)*ray + aoct(8,iatm)*rax
      mhex(9,4)  = mhex(9,4)  + aoct(5,iatm)*raz + aoct(5,iatm)*raz + aoct(6,iatm)*ray + aoct(9,iatm)*rax
      mhex(10,4) = mhex(10,4) + aoct(6,iatm)*raz + aoct(6,iatm)*raz + aoct(6,iatm)*raz + aoct(10,iatm)*rax
      mhex(11,4) = mhex(11,4) + aoct(7,iatm)*ray + aoct(7,iatm)*ray + aoct(7,iatm)*ray + aoct(7,iatm)*ray
      mhex(12,4) = mhex(12,4) + aoct(7,iatm)*raz + aoct(8,iatm)*ray + aoct(8,iatm)*ray + aoct(8,iatm)*ray
      mhex(13,4) = mhex(13,4) + aoct(8,iatm)*raz + aoct(8,iatm)*raz + aoct(9,iatm)*ray + aoct(9,iatm)*ray
      mhex(14,4) = mhex(14,4) + aoct(9,iatm)*raz + aoct(9,iatm)*raz + aoct(9,iatm)*raz + aoct(10,iatm)*ray
      mhex(15,4) = mhex(15,4) + aoct(10,iatm)*raz + aoct(10,iatm)*raz + aoct(10,iatm)*raz + aoct(10,iatm)*raz
      mhex(1,5)  = mhex(1,5)  + ahex(1,iatm)
      mhex(2,5)  = mhex(2,5)  + ahex(2,iatm)
      mhex(3,5)  = mhex(3,5)  + ahex(3,iatm)
      mhex(4,5)  = mhex(4,5)  + ahex(4,iatm)
      mhex(5,5)  = mhex(5,5)  + ahex(5,iatm)
      mhex(6,5)  = mhex(6,5)  + ahex(6,iatm)
      mhex(7,5)  = mhex(7,5)  + ahex(7,iatm)
      mhex(8,5)  = mhex(8,5)  + ahex(8,iatm)
      mhex(9,5)  = mhex(9,5)  + ahex(9,iatm)
      mhex(10,5) = mhex(10,5) + ahex(10,iatm)
      mhex(11,5) = mhex(11,5) + ahex(11,iatm)
      mhex(12,5) = mhex(12,5) + ahex(12,iatm)
      mhex(13,5) = mhex(13,5) + ahex(13,iatm)
      mhex(14,5) = mhex(14,5) + ahex(14,iatm)
      mhex(15,5) = mhex(15,5) + ahex(15,iatm)
   end do
! add the charge and dipole contributions to the total dipole
   do i = 1,3
      do j = 1,2
         mdip(i,3) = mdip(i,3) + mdip(i,j)
      enddo
   enddo
! add the charge, dipole and quadrupole contributions to the total quadrupole
   do i = 1,6
      do j = 1,3
         mquad(i,4) = mquad(i,4) + mquad(i,j)
      enddo
   enddo
! add the charge, dipole, quadrupole and octupole contributions to the total octupole
   do i = 1,10
      do j = 1,4
         moct(i,5) = moct(i,5) + moct(i,j)
      enddo
   enddo
! add the charge, dipole, quadrupole, octupole and hexadecapole contributions to the total hexadecapole
   do i = 1,15
      do j = 1,5
         mhex(i,6) = mhex(i,6) + mhex(i,j)
      enddo
   enddo
!        same in traceless form
!        Gaussian style definitions
!mquadt = mquad
!do j=1,4
!        trace = mquad(1,j) + mquad(4,j) + mquad(6,j)
!        mquadt(1,j) = (3.0d0*mquad(1,j) - trace) / 3.0d0
!        mquadt(4,j) = (3.0d0*mquad(4,j) - trace) / 3.0d0
!        mquadt(6,j) = (3.0d0*mquad(6,j) - trace) / 3.0d0
!end do

!       Stone/Buckingham style traceless
   mquadt = 3.0d0*mquad
   do j=1,4
      trace = mquad(1,j) + mquad(4,j) + mquad(6,j)
      mquadt(1,j) = mquadt(1,j) - trace
      mquadt(4,j) = mquadt(4,j) - trace
      mquadt(6,j) = mquadt(6,j) - trace
   end do
   mquadt = mquadt/2.0d0

   moctt = 5.0d0*moct
   do j=1,5
      trace  = moct(1,j) + moct(7,j) + moct(10,j)
      tracex = moct(1,j) + moct(4,j) + moct(6,j)
      tracey = moct(2,j) + moct(7,j) + moct(9,j)
      tracez = moct(3,j) + moct(8,j) + moct(10,j)
      moctt(1,j)  = moctt(1,j)  - 3.0d0*tracex
      moctt(2,j)  = moctt(2,j)  - tracey
      moctt(3,j)  = moctt(3,j)  - tracez
      moctt(4,j)  = moctt(4,j)  - tracex
      moctt(6,j)  = moctt(6,j)  - tracex
      moctt(7,j)  = moctt(7,j)  - 3.0d0*tracey
      moctt(8,j)  = moctt(8,j)  - tracez
      moctt(9,j)  = moctt(9,j)  - tracey
      moctt(10,j) = moctt(10,j) - 3.0d0*tracez
   end do
   moctt  = moctt/2.0d0

   mhext = 35.0d0*mhex
   do j=1,6
      trace   = mhex(1,j) + mhex(11,j) + mhex(15,j)
      trace   = trace + 2.0d0*( mhex(4,j) + mhex(6,j) + mhex(13,j) )
      tracexx = mhex(1,j) + mhex(4,j)  + mhex(6,j)
      tracexy = mhex(2,j) + mhex(7,j)  + mhex(9,j)
      tracexz = mhex(3,j) + mhex(8,j)  + mhex(10,j)
      traceyy = mhex(4,j) + mhex(11,j) + mhex(13,j)
      traceyz = mhex(5,j) + mhex(12,j) + mhex(14,j)
      tracezz = mhex(6,j) + mhex(13,j) + mhex(15,j)
      mhext(1,j)  = mhext(1,j)  - 30.0d0*tracexx + 3.0d0*trace
      mhext(2,j)  = mhext(2,j)  - 15.0d0*tracexy
      mhext(3,j)  = mhext(3,j)  - 15.0d0*tracexz
      mhext(4,j)  = mhext(4,j)  -  5.0d0*(tracexx + traceyy) + trace
      mhext(5,j)  = mhext(5,j)  -  5.0d0*traceyz
      mhext(6,j)  = mhext(6,j)  -  5.0d0*(tracexx + tracezz) + trace
      mhext(7,j)  = mhext(7,j)  - 15.0d0*tracexy
      mhext(8,j)  = mhext(8,j)  -  5.0d0*tracexz
      mhext(9,j)  = mhext(9,j)  -  5.0d0*tracexy
      mhext(10,j) = mhext(10,j) - 15.0d0*tracexz
      mhext(11,j) = mhext(11,j) - 30.0d0*traceyy + 3.0d0*trace
      mhext(12,j) = mhext(12,j) - 15.0d0*traceyz
      mhext(13,j) = mhext(13,j) -  5.0d0*(traceyy + tracezz) + trace
      mhext(14,j) = mhext(14,j) - 15.0d0*traceyz
      mhext(15,j) = mhext(15,j) - 30.0d0*tracezz + 3.0d0*trace
   end do
   mhext = mhext/8.0d0

   if (lprint) then
      write(*,*)' '
      write(*,*)' Atomic to molecular condensed quantities:'
      write(*,"('  Molecular monopole ',f15.8)")mchg
      write(*,*)' Dipole contributions: Atomic rank 0, 1, sum, exact'
      do i=1,3
         write(*,"(i5,6f15.8)")i-1,(mdip(j,i),j=1,3)
      end do
      write(*,"(i5,6f15.8)")9,(moldipol(j),j=1,3)
      write(*,*)' Cartesian Quadrupole contributions: Atomic rank 0, 1, 2, sum, exact'
      do i=1,4
         write(*,"(i5,6f15.8)")i-1,(mquad(j,i),j=1,6)
      end do
      write(*,"(i5,6f15.8)")9,(molquad(j),j=1,6)
      write(*,*)' Traceless Quadrupole contributions: Atomic rank 0, 1, 2, sum, exact'
      do i=1,4
         write(*,"(i5,6f15.8)")i-1,(mquadt(j,i),j=1,6)
      end do
      write(*,"(i5,6f15.8)")9,(molquadt(j),j=1,6)
      write(*,*)' Cartesian Octupole contributions: Atomic rank 0, 1, 2, 3, sum, exact'
      do i=1,5
         write(*,"(i5,10f10.3)")i-1,(moct(j,i),j=1,10)
      end do
      write(*,"(i5,10f10.3)")9,(moloct(j),j=1,10)
      write(*,*)' Traceless Octupole contributions: Atomic rank 0, 1, 2, 3, sum, exact'
      do i=1,5
         write(*,"(i5,10f10.3)")i-1,(moctt(j,i),j=1,10)
      end do
      write(*,"(i5,10f10.3)")9,(moloctt(j),j=1,10)
      write(*,"(a)")' Cartesian Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, sum, exact'
      do i=1,6
         write(*,"(i5,15f10.2)")i-1,(mhex(j,i),j=1,15)
      end do
      write(*,"(i5,15f10.2)")9,(molhex(j),j=1,15)
      write(*,"(a)")' Traceless Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, sum, exact'
      do i=1,6
         write(*,"(i5,15f10.2)")i-1,(mhext(j,i),j=1,15)
      end do
      write(*,"(i5,15f10.2)")9,(molhext(j),j=1,15)
   end if

end subroutine


subroutine makehfunc(rx,ry,rz,dgx,dgy,dgz,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,hfunc)
! constructs the geometry multipole functions
! the many conditional statements have been introduced to save computational time, without these the timings is a factor 2-3 larger
   logical lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex
   real*8 hfunc(4,4,15)
   real*8 rx,ry,rz,dgx,dgy,dgz

   hfunc = 0.0d0

! dipole geometry functions
   if (lcdip) then
      hfunc(1,1,1) = rx
      hfunc(1,1,2) = ry
      hfunc(1,1,3) = rz
   endif
! traceless quadrupole geometry functions
   if (lcquad .or. ldquad) then
      trc1 = rx*rx + ry*ry + rz*rz
      trc2 = rx*dgx + ry*dgy + rz*dgz
      trc2 = 2.0d0*trc2
   endif
   if (lcquad) then
      hfunc(1,2,1) = 0.50d0*(3.0d0*rx*rx - trc1)
      hfunc(1,2,2) = 0.50d0*(3.0d0*rx*ry)
      hfunc(1,2,3) = 0.50d0*(3.0d0*rx*rz)
      hfunc(1,2,4) = 0.50d0*(3.0d0*ry*ry - trc1)
      hfunc(1,2,5) = 0.50d0*(3.0d0*ry*rz)
      hfunc(1,2,6) = 0.50d0*(3.0d0*rz*rz - trc1)
   endif
   if (ldquad) then
      hfunc(2,2,1) = 0.50d0*(3.0d0*(rx*dgx + rx*dgx) - trc2)
      hfunc(2,2,2) = 0.50d0*(3.0d0*(rx*dgy + ry*dgx) )
      hfunc(2,2,3) = 0.50d0*(3.0d0*(rx*dgz + rz*dgx) )
      hfunc(2,2,4) = 0.50d0*(3.0d0*(ry*dgy + ry*dgy) - trc2)
      hfunc(2,2,5) = 0.50d0*(3.0d0*(ry*dgz + rz*dgy) )
      hfunc(2,2,6) = 0.50d0*(3.0d0*(rz*dgz + rz*dgz) - trc2)
   endif
! traceless octupole geometry functions
   if (lcoct .or. ldoct .or. lqoct) then
      trc1  = (rx*rx + ry*ry + rz*rz)
      trc1x = rx*trc1
      trc1y = ry*trc1
      trc1z = rz*trc1
      trc2  = rx*dgx + ry*dgy + rz*dgz
      trc2x = dgx*trc1 + 2.0d0*rx*trc2
      trc2y = dgy*trc1 + 2.0d0*ry*trc2
      trc2z = dgz*trc1 + 2.0d0*rz*trc2
      trc3  = dgx*dgx + dgy*dgy + dgz*dgz
      trc3x = rx*trc3 + 2.0d0*dgx*trc2
      trc3y = ry*trc3 + 2.0d0*dgy*trc2
      trc3z = rz*trc3 + 2.0d0*dgz*trc2
   endif
   if (lcoct) then
      hfunc(1,3,1)  = 0.50d0*(5.0d0*rx*rx*rx - 3.0d0*trc1x)
      hfunc(1,3,2)  = 0.50d0*(5.0d0*rx*rx*ry - trc1y)
      hfunc(1,3,3)  = 0.50d0*(5.0d0*rx*rx*rz - trc1z)
      hfunc(1,3,4)  = 0.50d0*(5.0d0*rx*ry*ry - trc1x)
      hfunc(1,3,5)  = 0.50d0*(5.0d0*rx*ry*rz)
      hfunc(1,3,6)  = 0.50d0*(5.0d0*rx*rz*rz - trc1x)
      hfunc(1,3,7)  = 0.50d0*(5.0d0*ry*ry*ry - 3.0d0*trc1y)
      hfunc(1,3,8)  = 0.50d0*(5.0d0*ry*ry*rz - trc1z)
      hfunc(1,3,9)  = 0.50d0*(5.0d0*ry*rz*rz - trc1y)
      hfunc(1,3,10) = 0.50d0*(5.0d0*rz*rz*rz - 3.0d0*trc1z)
   endif
   if (ldoct) then
      hfunc(2,3,1)  = 0.50d0*(5.0d0*(rx*rx*dgx + rx*rx*dgx + rx*rx*dgx) - 3.0d0*trc2x)
      hfunc(2,3,2)  = 0.50d0*(5.0d0*(rx*rx*dgy + rx*ry*dgx + ry*rx*dgx) - trc2y)
      hfunc(2,3,3)  = 0.50d0*(5.0d0*(rx*rx*dgz + rx*rz*dgx + rz*rx*dgx) - trc2z)
      hfunc(2,3,4)  = 0.50d0*(5.0d0*(rx*ry*dgy + ry*rx*dgy + ry*ry*dgx) - trc2x)
      hfunc(2,3,5)  = 0.50d0*(5.0d0*(rx*ry*dgz + ry*rz*dgx + rz*rx*dgy))
      hfunc(2,3,6)  = 0.50d0*(5.0d0*(rx*rz*dgz + rz*rx*dgz + rz*rz*dgx) - trc2x)
      hfunc(2,3,7)  = 0.50d0*(5.0d0*(ry*ry*dgy + ry*ry*dgy + ry*ry*dgy) - 3.0d0*trc2y)
      hfunc(2,3,8)  = 0.50d0*(5.0d0*(ry*ry*dgz + ry*rz*dgy + rz*ry*dgy) - trc2z)
      hfunc(2,3,9)  = 0.50d0*(5.0d0*(ry*rz*dgz + rz*ry*dgz + rz*rz*dgy) - trc2y)
      hfunc(2,3,10) = 0.50d0*(5.0d0*(rz*rz*dgz + rz*rz*dgz + rz*rz*dgz) - 3.0d0*trc2z)
   endif
   if (lqoct) then
      hfunc(3,3,1)  = 0.50d0*(5.0d0*(rx*dgx*dgx + rx*dgx*dgx + rx*dgx*dgx) - 3.0d0*trc3x)
      hfunc(3,3,2)  = 0.50d0*(5.0d0*(rx*dgx*dgy + rx*dgy*dgx + ry*dgx*dgx) - trc3y)
      hfunc(3,3,3)  = 0.50d0*(5.0d0*(rx*dgx*dgz + rx*dgz*dgx + rz*dgx*dgx) - trc3z)
      hfunc(3,3,4)  = 0.50d0*(5.0d0*(rx*dgy*dgy + ry*dgx*dgy + ry*dgy*dgx) - trc3x)
      hfunc(3,3,5)  = 0.50d0*(5.0d0*(rx*dgy*dgz + ry*dgz*dgx + rz*dgx*dgy))
      hfunc(3,3,6)  = 0.50d0*(5.0d0*(rx*dgz*dgz + rz*dgx*dgz + rz*dgz*dgx) - trc3x)
      hfunc(3,3,7)  = 0.50d0*(5.0d0*(ry*dgy*dgy + ry*dgy*dgy + ry*dgy*dgy) - 3.0d0*trc3y)
      hfunc(3,3,8)  = 0.50d0*(5.0d0*(ry*dgy*dgz + ry*dgz*dgy + rz*dgy*dgy) - trc3z)
      hfunc(3,3,9)  = 0.50d0*(5.0d0*(ry*dgz*dgz + rz*dgy*dgz + rz*dgz*dgy) - trc3y)
      hfunc(3,3,10) = 0.50d0*(5.0d0*(rz*dgz*dgz + rz*dgz*dgz + rz*dgz*dgz) - 3.0d0*trc3z)
   endif
! traceless hexadecapole geometry functions
   if (lchex .or. ldhex .or. lqhex .or. lohex) then
      trc1   = (rx*rx + ry*ry + rz*rz)
      trc12  = trc1*trc1
      trc1xx = rx*rx*trc1
      trc1xy = rx*ry*trc1
      trc1xz = rx*rz*trc1
      trc1yy = ry*ry*trc1
      trc1yz = ry*rz*trc1
      trc1zz = rz*rz*trc1
      trc2   = rx*dgx + ry*dgy + rz*dgz
      trc22  = 4.0d0*trc1*trc2
      trc2xx = rx*dgx*trc1 + rx*dgx*trc1 + 2.0d0*rx*rx*trc2
      trc2xy = rx*dgy*trc1 + ry*dgx*trc1 + 2.0d0*rx*ry*trc2
      trc2xz = rx*dgz*trc1 + rz*dgx*trc1 + 2.0d0*rx*rz*trc2
      trc2yy = ry*dgy*trc1 + ry*dgy*trc1 + 2.0d0*ry*ry*trc2
      trc2yz = ry*dgz*trc1 + rz*dgy*trc1 + 2.0d0*ry*rz*trc2
      trc2zz = rz*dgz*trc1 + rz*dgz*trc1 + 2.0d0*rz*rz*trc2
      trc3   = dgx*dgx + dgy*dgy + dgz*dgz
      trc32  = 2.0d0*( trc1*trc3 + 2.0d0*trc2*trc2 )
      trc3xx = dgx*dgx*trc1 + rx*rx*trc3 + 2.0d0*rx*dgx*trc2 + 2.0d0*rx*dgx*trc2
      trc3xy = dgx*dgy*trc1 + rx*ry*trc3 + 2.0d0*rx*dgy*trc2 + 2.0d0*ry*dgx*trc2
      trc3xz = dgx*dgz*trc1 + rx*rz*trc3 + 2.0d0*rx*dgz*trc2 + 2.0d0*rz*dgx*trc2
      trc3yy = dgy*dgy*trc1 + ry*ry*trc3 + 2.0d0*ry*dgy*trc2 + 2.0d0*ry*dgy*trc2
      trc3yz = dgy*dgz*trc1 + ry*rz*trc3 + 2.0d0*ry*dgz*trc2 + 2.0d0*rz*dgy*trc2
      trc3zz = dgz*dgz*trc1 + rz*rz*trc3 + 2.0d0*rz*dgz*trc2 + 2.0d0*rz*dgz*trc2
      trc42  = 4.0d0*trc2*trc3
      trc4xx = rx*dgx*trc3 + rx*dgx*trc3 + 2.0d0*dgx*dgx*trc2
      trc4xy = rx*dgy*trc3 + ry*dgx*trc3 + 2.0d0*dgx*dgy*trc2
      trc4xz = rx*dgz*trc3 + rz*dgx*trc3 + 2.0d0*dgx*dgz*trc2
      trc4yy = ry*dgy*trc3 + ry*dgy*trc3 + 2.0d0*dgy*dgy*trc2
      trc4yz = ry*dgz*trc3 + rz*dgy*trc3 + 2.0d0*dgy*dgz*trc2
      trc4zz = rz*dgz*trc3 + rz*dgz*trc3 + 2.0d0*dgz*dgz*trc2
   endif
   if (lchex) then
      hfunc(1,4, 1) = 0.125d0*(35.0d0*rx*rx*rx*rx - 30.0d0*trc1xx + 3.0d0*trc12)
      hfunc(1,4, 2) = 0.125d0*(35.0d0*rx*rx*rx*ry - 15.0d0*trc1xy)
      hfunc(1,4, 3) = 0.125d0*(35.0d0*rx*rx*rx*rz - 15.0d0*trc1xz)
      hfunc(1,4, 4) = 0.125d0*(35.0d0*rx*rx*ry*ry -  5.0d0*(trc1xx+trc1yy) + trc12)
      hfunc(1,4, 5) = 0.125d0*(35.0d0*rx*rx*ry*rz -  5.0d0*trc1yz)
      hfunc(1,4, 6) = 0.125d0*(35.0d0*rx*rx*rz*rz -  5.0d0*(trc1xx+trc1zz) + trc12)
      hfunc(1,4, 7) = 0.125d0*(35.0d0*rx*ry*ry*ry - 15.0d0*trc1xy)
      hfunc(1,4, 8) = 0.125d0*(35.0d0*rx*ry*ry*rz -  5.0d0*trc1xz)
      hfunc(1,4, 9) = 0.125d0*(35.0d0*rx*ry*rz*rz -  5.0d0*trc1xy)
      hfunc(1,4,10) = 0.125d0*(35.0d0*rx*rz*rz*rz - 15.0d0*trc1xz)
      hfunc(1,4,11) = 0.125d0*(35.0d0*ry*ry*ry*ry - 30.0d0*trc1yy + 3.0d0*trc12)
      hfunc(1,4,12) = 0.125d0*(35.0d0*ry*ry*ry*rz - 15.0d0*trc1yz)
      hfunc(1,4,13) = 0.125d0*(35.0d0*ry*ry*rz*rz -  5.0d0*(trc1yy+trc1zz) + trc12)
      hfunc(1,4,14) = 0.125d0*(35.0d0*ry*rz*rz*rz - 15.0d0*trc1yz)
      hfunc(1,4,15) = 0.125d0*(35.0d0*rz*rz*rz*rz - 30.0d0*trc1zz + 3.0d0*trc12)
   endif
   if (ldhex) then
      hfunc(2,4, 1) = 0.125d0*(35.0d0*(rx*rx*rx*dgx + rx*rx*rx*dgx + rx*rx*rx*dgx + rx*rx*rx*dgx) - 30.0d0*trc2xx + 3.0d0*trc22)
      hfunc(2,4, 2) = 0.125d0*(35.0d0*(rx*rx*rx*dgy + rx*rx*ry*dgx + rx*ry*rx*dgx + ry*rx*rx*dgx) - 15.0d0*trc2xy)
      hfunc(2,4, 3) = 0.125d0*(35.0d0*(rx*rx*rx*dgz + rx*rx*rz*dgx + rx*rz*rx*dgx + rz*rx*rx*dgx) - 15.0d0*trc2xz)
      hfunc(2,4, 4) = 0.125d0*(35.0d0*(rx*rx*ry*dgy + rx*rx*ry*dgy + ry*ry*rx*dgx + ry*ry*rx*dgx) -  5.0d0*(trc2xx+trc2yy) + trc22)
      hfunc(2,4, 5) = 0.125d0*(35.0d0*(rx*rx*ry*dgz + rx*rx*rz*dgy + rx*ry*rz*dgx + rx*ry*rz*dgx) -  5.0d0*trc2yz)
      hfunc(2,4, 6) = 0.125d0*(35.0d0*(rx*rx*rz*dgz + rx*rx*rz*dgz + rz*rz*rx*dgx + rz*rz*rx*dgx) -  5.0d0*(trc2xx+trc2zz) + trc22)
      hfunc(2,4, 7) = 0.125d0*(35.0d0*(rx*ry*ry*dgy + ry*rx*ry*dgy + ry*ry*rx*dgy + ry*ry*ry*dgx) - 15.0d0*trc2xy)
      hfunc(2,4, 8) = 0.125d0*(35.0d0*(rx*ry*ry*dgz + rx*ry*rz*dgy + rx*ry*rz*dgy + ry*ry*rz*dgx) -  5.0d0*trc2xz)
      hfunc(2,4, 9) = 0.125d0*(35.0d0*(rx*ry*rz*dgz + rx*ry*rz*dgz + rx*rz*rz*dgy + ry*rz*rz*dgx) -  5.0d0*trc2xy)
      hfunc(2,4,10) = 0.125d0*(35.0d0*(rx*rz*rz*dgz + rz*rx*rz*dgz + rz*rz*rx*dgz + rz*rz*rz*dgx) - 15.0d0*trc2xz)
      hfunc(2,4,11) = 0.125d0*(35.0d0*(ry*ry*ry*dgy + ry*ry*ry*dgy + ry*ry*ry*dgy + ry*ry*ry*dgy) - 30.0d0*trc2yy + 3.0d0*trc22)
      hfunc(2,4,12) = 0.125d0*(35.0d0*(ry*ry*ry*dgz + ry*ry*rz*dgy + ry*rz*ry*dgy + rz*ry*ry*dgy) - 15.0d0*trc2yz)
      hfunc(2,4,13) = 0.125d0*(35.0d0*(ry*ry*rz*dgz + ry*ry*rz*dgz + rz*rz*ry*dgy + rz*rz*ry*dgy) -  5.0d0*(trc2yy+trc2zz) + trc22)
      hfunc(2,4,14) = 0.125d0*(35.0d0*(ry*rz*rz*dgz + rz*ry*rz*dgz + rz*rz*ry*dgz + rz*rz*rz*dgy) - 15.0d0*trc2yz)
      hfunc(2,4,15) = 0.125d0*(35.0d0*(rz*rz*rz*dgz + rz*rz*rz*dgz + rz*rz*rz*dgz + rz*rz*rz*dgz) - 30.0d0*trc2zz + 3.0d0*trc22)
   endif
   if (lqhex) then
      hfunc(3,4, 1) = 0.125d0*(35.0d0*(rx*rx*dgx*dgx + rx*rx*dgx*dgx + rx*rx*dgx*dgx + rx*rx*dgx*dgx + rx*rx*dgx*dgx + rx*rx*dgx*dgx) - 30.0d0*trc3xx + 3.0d0*trc32)
      hfunc(3,4, 2) = 0.125d0*(35.0d0*(rx*rx*dgx*dgy + rx*rx*dgx*dgy + rx*rx*dgx*dgy + ry*rx*dgx*dgx + ry*rx*dgx*dgx + ry*rx*dgx*dgx) - 15.0d0*trc3xy)
      hfunc(3,4, 3) = 0.125d0*(35.0d0*(rx*rx*dgx*dgz + rx*rx*dgx*dgz + rx*rx*dgx*dgz + rz*rx*dgx*dgx + rz*rx*dgx*dgx + rz*rx*dgx*dgx) - 15.0d0*trc3xz)
      hfunc(3,4, 4) = 0.125d0*(35.0d0*(rx*rx*dgy*dgy + rx*ry*dgx*dgy + rx*ry*dgx*dgy + rx*ry*dgx*dgy + rx*ry*dgx*dgy + ry*ry*dgx*dgx) -  5.0d0*(trc3xx+trc3yy) + trc32)
      hfunc(3,4, 5) = 0.125d0*(35.0d0*(rx*rx*dgy*dgz + rx*ry*dgx*dgz + rx*ry*dgx*dgz + rx*rz*dgx*dgy + rx*rz*dgx*dgy + ry*rz*dgx*dgx) -  5.0d0*trc3yz)
      hfunc(3,4, 6) = 0.125d0*(35.0d0*(rx*rx*dgz*dgz + rx*rz*dgx*dgz + rx*rz*dgx*dgz + rx*rz*dgx*dgz + rx*rz*dgx*dgz + rz*rz*dgx*dgx) -  5.0d0*(trc3xx+trc3zz) + trc32)
      hfunc(3,4, 7) = 0.125d0*(35.0d0*(rx*ry*dgy*dgy + rx*ry*dgy*dgy + rx*ry*dgy*dgy + ry*ry*dgy*dgx + ry*ry*dgy*dgx + ry*ry*dgy*dgx) - 15.0d0*trc3xy)
      hfunc(3,4, 8) = 0.125d0*(35.0d0*(ry*ry*dgx*dgz + ry*rz*dgx*dgy + ry*rz*dgx*dgy + rx*ry*dgy*dgz + rx*ry*dgy*dgz + rx*rz*dgy*dgy) -  5.0d0*trc3xz)
      hfunc(3,4, 9) = 0.125d0*(35.0d0*(rx*ry*dgz*dgz + rx*rz*dgy*dgz + rx*rz*dgy*dgz + ry*rz*dgx*dgz + ry*rz*dgx*dgz + rz*rz*dgx*dgy) -  5.0d0*trc3xy)
      hfunc(3,4,10) = 0.125d0*(35.0d0*(rz*rz*dgz*dgx + rz*rz*dgz*dgx + rz*rz*dgz*dgx + rx*rz*dgz*dgz + rx*rz*dgz*dgz + rx*rz*dgz*dgz) - 15.0d0*trc3xz)
      hfunc(3,4,11) = 0.125d0*(35.0d0*(ry*ry*dgy*dgy + ry*ry*dgy*dgy + ry*ry*dgy*dgy + ry*ry*dgy*dgy + ry*ry*dgy*dgy + ry*ry*dgy*dgy) - 30.0d0*trc3yy + 3.0d0*trc32)
      hfunc(3,4,12) = 0.125d0*(35.0d0*(ry*ry*dgy*dgz + ry*ry*dgy*dgz + ry*ry*dgy*dgz + rz*ry*dgy*dgy + rz*ry*dgy*dgy + rz*ry*dgy*dgy) - 15.0d0*trc3yz)
      hfunc(3,4,13) = 0.125d0*(35.0d0*(ry*ry*dgz*dgz + ry*rz*dgy*dgz + ry*rz*dgy*dgz + ry*rz*dgy*dgz + ry*rz*dgy*dgz + rz*rz*dgy*dgy) -  5.0d0*(trc3yy+trc3zz) + trc32)
      hfunc(3,4,14) = 0.125d0*(35.0d0*(rz*rz*dgz*dgy + rz*rz*dgz*dgy + rz*rz*dgz*dgy + ry*rz*dgz*dgz + ry*rz*dgz*dgz + ry*rz*dgz*dgz) - 15.0d0*trc3yz)
      hfunc(3,4,15) = 0.125d0*(35.0d0*(rz*rz*dgz*dgz + rz*rz*dgz*dgz + rz*rz*dgz*dgz + rz*rz*dgz*dgz + rz*rz*dgz*dgz + rz*rz*dgz*dgz) - 30.0d0*trc3zz + 3.0d0*trc32)
   endif
   if (lohex) then
      hfunc(4,4, 1) = 0.125d0*(35.0d0*(rx*dgx*dgx*dgx + rx*dgx*dgx*dgx + rx*dgx*dgx*dgx + rx*dgx*dgx*dgx) - 30.0d0*trc4xx + 3.0d0*trc42)
      hfunc(4,4, 2) = 0.125d0*(35.0d0*(rx*dgx*dgx*dgy + rx*dgx*dgy*dgx + rx*dgy*dgx*dgx + ry*dgx*dgx*dgx) - 15.0d0*trc4xy)
      hfunc(4,4, 3) = 0.125d0*(35.0d0*(rx*dgx*dgx*dgz + rx*dgx*dgz*dgx + rx*dgz*dgx*dgx + rz*dgx*dgx*dgx) - 15.0d0*trc4xz)
      hfunc(4,4, 4) = 0.125d0*(35.0d0*(rx*dgx*dgy*dgy + rx*dgx*dgy*dgy + ry*dgy*dgx*dgx + ry*dgy*dgx*dgx) -  5.0d0*(trc4xx+trc4yy) + trc42)
      hfunc(4,4, 5) = 0.125d0*(35.0d0*(rx*dgx*dgy*dgz + rx*dgx*dgy*dgz + ry*dgx*dgx*dgz + rz*dgx*dgx*dgy) -  5.0d0*trc4yz)
      hfunc(4,4, 6) = 0.125d0*(35.0d0*(rx*dgx*dgz*dgz + rx*dgx*dgz*dgz + rz*dgz*dgx*dgx + rz*dgz*dgx*dgx) -  5.0d0*(trc4xx+trc4zz) + trc42)
      hfunc(4,4, 7) = 0.125d0*(35.0d0*(rx*dgy*dgy*dgy + ry*dgx*dgy*dgy + ry*dgy*dgx*dgy + ry*dgy*dgy*dgx) - 15.0d0*trc4xy)
      hfunc(4,4, 8) = 0.125d0*(35.0d0*(rx*dgy*dgy*dgz + ry*dgx*dgy*dgz + ry*dgx*dgy*dgz + rz*dgx*dgy*dgy) -  5.0d0*trc4xz)
      hfunc(4,4, 9) = 0.125d0*(35.0d0*(rx*dgy*dgz*dgz + ry*dgx*dgz*dgz + rz*dgx*dgy*dgz + rz*dgx*dgy*dgz) -  5.0d0*trc4xy)
      hfunc(4,4,10) = 0.125d0*(35.0d0*(rx*dgz*dgz*dgz + rz*dgx*dgz*dgz + rz*dgz*dgx*dgz + rz*dgz*dgz*dgx) - 15.0d0*trc4xz)
      hfunc(4,4,11) = 0.125d0*(35.0d0*(ry*dgy*dgy*dgy + ry*dgy*dgy*dgy + ry*dgy*dgy*dgy + ry*dgy*dgy*dgy) - 30.0d0*trc4yy + 3.0d0*trc42)
      hfunc(4,4,12) = 0.125d0*(35.0d0*(ry*dgy*dgy*dgz + ry*dgy*dgz*dgy + ry*dgz*dgy*dgy + rz*dgy*dgy*dgy) - 15.0d0*trc4yz)
      hfunc(4,4,13) = 0.125d0*(35.0d0*(ry*dgy*dgz*dgz + ry*dgy*dgz*dgz + rz*dgz*dgy*dgy + rz*dgz*dgy*dgy) -  5.0d0*(trc4yy+trc4zz) + trc42)
      hfunc(4,4,14) = 0.125d0*(35.0d0*(ry*dgz*dgz*dgz + rz*dgy*dgz*dgz + rz*dgz*dgy*dgz + rz*dgz*dgz*dgy) - 15.0d0*trc4yz)
      hfunc(4,4,15) = 0.125d0*(35.0d0*(rz*dgz*dgz*dgz + rz*dgz*dgz*dgz + rz*dgz*dgz*dgz + rz*dgz*dgz*dgz) - 30.0d0*trc4zz + 3.0d0*trc42)
   endif

end subroutine


subroutine makempole(maxshell,ncenter,ishell,jatm,dx,dy,dz,wtmp,lmult,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex,shelldip,shellquad,shelloct,shellhex)
! constructs the shell multipoles
   real*8 dx,dy,dz,wtmp
   real*8 shellchg(maxshell,ncenter), shelldip(3,maxshell,ncenter), shellquad(6,maxshell,ncenter)      ! shell charges, dipole and (Cartesian) quadrupole
   real*8 shelloct(10,maxshell,ncenter), shellhex(15,maxshell,ncenter)                                 ! shell octupole, hexadecapole
   logical lmult,lcdip,lcquad,ldquad,lcoct,ldoct,lqoct,lchex,ldhex,lqhex,lohex
   integer maxshell,ishell,jatm

   if (lmult .or. lcdip) then
      shelldip(1,ishell,jatm) = shelldip(1,ishell,jatm) + wtmp*dx
      shelldip(2,ishell,jatm) = shelldip(2,ishell,jatm) + wtmp*dy
      shelldip(3,ishell,jatm) = shelldip(3,ishell,jatm) + wtmp*dz
   endif
   if (lmult .or. lcquad .or. ldquad) then
      shellquad(1,ishell,jatm) = shellquad(1,ishell,jatm) + wtmp*dx*dx
      shellquad(2,ishell,jatm) = shellquad(2,ishell,jatm) + wtmp*dx*dy
      shellquad(3,ishell,jatm) = shellquad(3,ishell,jatm) + wtmp*dx*dz
      shellquad(4,ishell,jatm) = shellquad(4,ishell,jatm) + wtmp*dy*dy
      shellquad(5,ishell,jatm) = shellquad(5,ishell,jatm) + wtmp*dy*dz
      shellquad(6,ishell,jatm) = shellquad(6,ishell,jatm) + wtmp*dz*dz
   endif
   if (lmult .or. lcoct .or. ldoct .or. lqoct) then
      shelloct(1,ishell,jatm) = shelloct(1,ishell,jatm) + wtmp*dx*dx*dx
      shelloct(2,ishell,jatm) = shelloct(2,ishell,jatm) + wtmp*dx*dx*dy
      shelloct(3,ishell,jatm) = shelloct(3,ishell,jatm) + wtmp*dx*dx*dz
      shelloct(4,ishell,jatm) = shelloct(4,ishell,jatm) + wtmp*dx*dy*dy
      shelloct(5,ishell,jatm) = shelloct(5,ishell,jatm) + wtmp*dx*dy*dz
      shelloct(6,ishell,jatm) = shelloct(6,ishell,jatm) + wtmp*dx*dz*dz
      shelloct(7,ishell,jatm) = shelloct(7,ishell,jatm) + wtmp*dy*dy*dy
      shelloct(8,ishell,jatm) = shelloct(8,ishell,jatm) + wtmp*dy*dy*dz
      shelloct(9,ishell,jatm) = shelloct(9,ishell,jatm) + wtmp*dy*dz*dz
      shelloct(10,ishell,jatm) = shelloct(10,ishell,jatm) + wtmp*dz*dz*dz
   endif
   if (lmult .or. lchex .or. ldhex .or. lqhex .or. lohex) then
      shellhex(1,ishell,jatm) = shellhex(1,ishell,jatm) + wtmp*dx*dx*dx*dx
      shellhex(2,ishell,jatm) = shellhex(2,ishell,jatm) + wtmp*dx*dx*dx*dy
      shellhex(3,ishell,jatm) = shellhex(3,ishell,jatm) + wtmp*dx*dx*dx*dz
      shellhex(4,ishell,jatm) = shellhex(4,ishell,jatm) + wtmp*dx*dx*dy*dy
      shellhex(5,ishell,jatm) = shellhex(5,ishell,jatm) + wtmp*dx*dx*dy*dz
      shellhex(6,ishell,jatm) = shellhex(6,ishell,jatm) + wtmp*dx*dx*dz*dz
      shellhex(7,ishell,jatm) = shellhex(7,ishell,jatm) + wtmp*dx*dy*dy*dy
      shellhex(8,ishell,jatm) = shellhex(8,ishell,jatm) + wtmp*dx*dy*dy*dz
      shellhex(9,ishell,jatm) = shellhex(9,ishell,jatm) + wtmp*dx*dy*dz*dz
      shellhex(10,ishell,jatm) = shellhex(10,ishell,jatm) + wtmp*dx*dz*dz*dz
      shellhex(11,ishell,jatm) = shellhex(11,ishell,jatm) + wtmp*dy*dy*dy*dy
      shellhex(12,ishell,jatm) = shellhex(12,ishell,jatm) + wtmp*dy*dy*dy*dz
      shellhex(13,ishell,jatm) = shellhex(13,ishell,jatm) + wtmp*dy*dy*dz*dz
      shellhex(14,ishell,jatm) = shellhex(14,ishell,jatm) + wtmp*dy*dz*dz*dz
      shellhex(15,ishell,jatm) = shellhex(15,ishell,jatm) + wtmp*dz*dz*dz*dz
   endif

end subroutine


subroutine dblint(mshell,shpop,shsig)
! frj: do a numerical integration to get the Vne energy
! frj: do a double numerical integration to get the Vee energy
   use defvar
   use functions
   use util
   implicit real*8 (a-h,o-z)
   type(content) gridatm(radpot*sphpot),gridatmorg(radpot*sphpot)
   real*8 beckeweigrid(radpot*sphpot)
   integer,parameter :: maxshell=6
   real*8 shpop(maxshell,ncenter),shsig(maxshell,ncenter) !Shell populations and shell sigma (width)
   real*8 rho0sh(maxshell,ncenter) !Shell density at current grid
   real*8 tmpdens(radpot*sphpot,ncenter) !tmpdens(ipt,iatm) corresponds to contribution of iatm to molecular density at grid ipt, and meantime multiplied by single-center integration weight at that point
   integer mshell(ncenter) !Actual number of shells of atoms
   integer :: ioutshell=0,ignorefar=1
   real*8 :: eps=1D-14
!frj arrays for integration
   type(content) gridkatm(radpot*sphpot)
   real*8 beckewekgrid(radpot*sphpot)
   real*8 rhok0sh(maxshell,ncenter)
   real*8 vnn(ncenter,ncenter),vne(ncenter,ncenter,maxshell),vee(ncenter,ncenter,maxshell,maxshell),vaa(ncenter,ncenter)
!frj

!write(*,*)' dblint: shell parameters'
   write(*,*)
   write(*,*) "Population and Alpha of each shell"
   do iatm=1,ncenter
      write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,mshell(iatm)),(1.0d0/shsig(ish,iatm),ish=1,mshell(iatm))
   end do
!if (ioutshell==1) then
!    write(*,*)
!    write(*,*) "Population of each shell"
!    do iatm=1,ncenter
!       write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shpop(ish,iatm),ish=1,mshell(iatm))
!    end do
!    write(*,*)
!    write(*,*) "Width (sigma) of each shell in Bohr"
!    do iatm=1,ncenter
!       write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(shsig(ish,iatm),ish=1,mshell(iatm))
!    end do
!    write(*,*) "Alpha of each shell in Bohr-1"
!    do iatm=1,ncenter
!	write(*,"(i5,'(',a,'):',6f12.6)") iatm,a(iatm)%name,(1.0d0/shsig(ish,iatm),ish=1,mshell(iatm))
!    end do
!end if

!Prepare actual density of present system at integration points
!Atomic center grids, only for isolated systems
   call walltime(iwalltime1)
   ntotpot=radpot*sphpot
   call gen1cintgrid(gridatmorg,iradcut)
   write(*,"(' Radial grids:',i4,'  Angular grids:',i5,'  Total:',i7,'  After pruning:',i7)") radpot,sphpot,radpot*sphpot,radpot*sphpot-iradcut*sphpot
   write(*,"(a)") " Calculating atomic contribution to electron density of present system on grid points..."
   ifinish=0
   call showprog(ifinish,ncenter)
!$OMP PARALLEL DO SHARED(tmpdens,ifinish) PRIVATE(iatm,gridatm,beckeweigrid,dtmp) schedule(dynamic) NUM_THREADS(nthreads)
   do iatm=1,ncenter
      gridatm%value=gridatmorg%value
      gridatm%x=gridatmorg%x+a(iatm)%x
      gridatm%y=gridatmorg%y+a(iatm)%y
      gridatm%z=gridatmorg%z+a(iatm)%z
      call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)
      do ipt=1+iradcut*sphpot,ntotpot
         dtmp = fdens(gridatm(ipt)%x,gridatm(ipt)%y,gridatm(ipt)%z)
         tmpdens(ipt,iatm) = dtmp*gridatm(ipt)%value*beckeweigrid(ipt)
      end do
      !$OMP CRITICAL
      ifinish=ifinish+1
      call showprog(ifinish,ncenter)
      !$OMP END CRITICAL
   end do
!$OMP END PARALLEL DO
   call walltime(iwalltime2)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime2-iwalltime1


!Using multicenter integration to evaluate population of various shells of various atoms based on present sigma (Eq. 18 of MBIS paper)
   totnele = 0.0d0
   vne  = 0.0d0
   vee  = 0.0d0
   do iatm=1,ncenter
      gridatm%value=gridatmorg%value
      ! frj
      gridatm%x=gridatmorg%x+a(iatm)%x
      gridatm%y=gridatmorg%y+a(iatm)%y
      gridatm%z=gridatmorg%z+a(iatm)%z
      call gen1cbeckewei(iatm,iradcut,gridatm,beckeweigrid,covr_tianlu,3)     ! frj
      do ipt=1+iradcut*sphpot,ntotpot
         rho0sh(:,:)=0 !Record {rho_0_Ai} at present grid, namely density of shell i of atom A at this integration point, constructed by Eq. 7 of MBIS paper
         rho0=0 !rho_0, namely reference density at this integration point, constructed by Eq. 6 of MBIS paper
         do jatm=1,ncenter
            dx = gridatm(ipt)%x - a(jatm)%x
            dy = gridatm(ipt)%y - a(jatm)%y
            dz = gridatm(ipt)%z - a(jatm)%z
            dis2 = dx*dx + dy*dy + dz*dz
            if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested
            dis=dsqrt(dis2)
            do jshell=1,mshell(jatm)
               sigval = shsig(jshell,jatm)
               tmp = shpop(jshell,jatm)/sigval**3/8/pi*exp(-dis/sigval) !Eq. 7 of MBIS paper
               rho0sh(jshell,jatm) = tmp
               rho0 = rho0 + tmp
            end do
         end do
         !Accumulate contribution of this integration grid
         tmpden = tmpdens(ipt,iatm)
         if (rho0>0.and.tmpden>eps) then
            do jatm=1,ncenter
               dx = gridatm(ipt)%x - a(jatm)%x
               dy = gridatm(ipt)%y - a(jatm)%y
               dz = gridatm(ipt)%z - a(jatm)%z
               dis2 = dx*dx + dy*dy + dz*dz
!				if (ignorefar==1.and.dis2>atmrhocutsqr(a(jatm)%index)) cycle !My tested
               dis=dsqrt(dis2)
               do jshell=1,mshell(jatm)
!                                       wtmp is the electron density at the current grid point
                  wtmp = tmpden*rho0sh(jshell,jatm)/rho0
!                                       accumulate the total density for check
                  totnele = totnele + wtmp
!                                       calculate the Vne contribution
                  do katm=1,ncenter
                     zknuc = a(katm)%charge
                     rx = gridatm(ipt)%x - a(katm)%x
                     ry = gridatm(ipt)%y - a(katm)%y
                     rz = gridatm(ipt)%z - a(katm)%z
                     rr2 = rx*rx + ry*ry + rz*rz
                     rr1 = dsqrt(rr2)
!                                               accumulate energy contribution, note minus sign
                     vne(katm,jatm,jshell) = vne(katm,jatm,jshell) - zknuc*wtmp/rr1
                  end do
!                                       construct another grid to calculate the Vee
                  do katm=1,ncenter
                     gridkatm%value=gridatmorg%value

                     gridkatm%x=gridatmorg%x+a(katm)%x
                     gridkatm%y=gridatmorg%y+a(katm)%y
                     gridkatm%z=gridatmorg%z+a(katm)%z
                     call gen1cbeckewei(katm,iradcut,gridkatm,beckewekgrid,covr_tianlu,3)
                     do kpt=1+iradcut*sphpot,ntotpot
                        rhok0sh(:,:)=0
                        rhok0=0
!                                                       grid-grid distance
                        rgx = gridkatm(kpt)%x - gridatm(ipt)%x
                        rgy = gridkatm(kpt)%y - gridatm(ipt)%y
                        rgz = gridkatm(kpt)%z - gridatm(ipt)%z
                        rg2 = rgx*rgx + rgy*rgy + rgz*rgz
                        rg1=dsqrt(rg2)
                        do latm=1,ncenter
                           rx = gridkatm(kpt)%x - a(latm)%x
                           ry = gridkatm(kpt)%y - a(latm)%y
                           rz = gridkatm(kpt)%z - a(latm)%z
                           rr2 = rx*rx + ry*ry + rz*rz
!                 	                                        if (ignorefar==1.and.rr2>atmrhocutsqr(a(latm)%index)) cycle !My tested
                           rr1=dsqrt(rr2)
                           do lshell=1,mshell(latm)
                              sigval = shsig(lshell,latm)
                              tmp = shpop(lshell,latm)/sigval**3/8/pi*exp(-rr1/sigval)
                              rhok0sh(lshell,latm) = tmp
                              rhok0 = rhok0 + tmp
                           end do
                        end do
                        tmpkden = tmpdens(kpt,katm)
                        if (rhok0>0.and.tmpkden>eps) then
                           do latm=1,ncenter
                              rx = gridkatm(kpt)%x - a(latm)%x
                              ry = gridkatm(kpt)%y - a(latm)%y
                              rz = gridkatm(kpt)%z - a(latm)%z
                              rr2 = rx*rx + ry*ry + rz*rz
!                                        				if (ignorefar==1.and.rr2>atmrhocutsqr(a(latm)%index)) cycle !My tested
                              rr1=dsqrt(rr2)
                              do lshell=1,mshell(latm)
!                                                                               wktmp is the electron density at the current grid point
                                 wktmp = tmpkden*rhok0sh(lshell,latm)/rhok0
!                                                                               calculate the Vee contribution
                                 if (rg1.gt.eps) then
                                    vee(jatm,latm,jshell,lshell) = vee(jatm,latm,jshell,lshell) + wtmp*wktmp/rg1
                                 end if
                              end do
                           end do
                        end if
                     end do
                  end do
               end do
            end do
         end if
      end do
   end do

   write(*,"(a,f15.8)")' Integrated number of electrons       = ',totnele

!do katm=1,ncenter
!                write(*,*) katm,mshell(katm)
!end do

! the nuclear-nuclear term
   vnn=0.0d0
   do iatm = 1,ncenter
      zinuc = a(iatm)%charge
      do jatm = 1,iatm-1
         zjnuc = a(jatm)%charge
         rx = a(iatm)%x - a(jatm)%x
         ry = a(iatm)%y - a(jatm)%y
         rz = a(iatm)%z - a(jatm)%z
         rr2 = rx*rx + ry*ry + rz*rz
         rr1 = dsqrt(rr2)
         vnn(iatm,jatm) = zinuc*zjnuc/rr1
         vnn(jatm,iatm) = zinuc*zjnuc/rr1
      end do
   end do
   totvnn = sum(vnn)
   totvnn = 0.5d0*totvnn
   write(*,*)' '
   write(*,"(a,f15.8)")' Vnn interactions, total              = ',totvnn
!write(*,"(a)")'     Center-1  Center-2                        Vnn'
   do katm=1,ncenter
      do jatm=1,katm-1
!                write(*,"(2i10,20x,6f15.8)") jatm,katm,vnn(jatm,katm)
      end do
   end do

   totvne = sum(vne)
   write(*,*)' '
   write(*,"(a,f15.8)")' Vne interactions, total              = ',totvne
!write(*,"(a)")'     Center-1  Center-2   Shell-2               Vne'
   do katm=1,ncenter
      do jatm=1,ncenter
         do jsh=1,mshell(jatm)
!                        write(*,"(3i10,10x,6f15.8)") katm,jatm,jsh,vne(katm,jatm,jsh)
         end do
      end do
   end do

! the double loop has overcounted by a factor of 2
   vee = 0.5d0*vee
   totvee = sum(vee)
   write(*,*)' '
   write(*,"(a,f15.8)")' Jee interactions, total              = ',totvee
!write(*,"(a)")'     Center-1   Shell-1  Center-2   Shell-2     Jee'
   do katm=1,ncenter
      do ksh=1,mshell(katm)
         do jatm=1,ncenter
            do jsh=1,mshell(jatm)
!                                write(*,"(4i10,6f15.8)") katm,ksh,jatm,jsh,vee(katm,jatm,ksh,jsh)
            end do
         end do
      end do
   end do

! condense to atom-atom interactions by summing over shells and Vnn, Vne, Vee contributionas
   vaa = vnn
!write(*,*)vaa
   do katm=1,ncenter
      do jatm=1,ncenter
         if (jatm.ne.katm) then
            do jsh=1,mshell(jatm)
               vaa(katm,jatm) = vaa(katm,jatm) + vne(katm,jatm,jsh)
               vaa(jatm,katm) = vaa(jatm,katm) + vne(katm,jatm,jsh)
!write(*,*)'add1',katm,jatm,jsh,vne(katm,jatm,jsh)
            end do
         end if
      end do
   end do
!write(*,*)vaa
   do katm=1,ncenter
      do ksh=1,mshell(katm)
         do jatm=1,ncenter
            if (jatm.ne.katm) then
               do jsh=1,mshell(jatm)
                  vaa(katm,jatm) = vaa(katm,jatm) + vee(katm,jatm,ksh,jsh)
                  vaa(jatm,katm) = vaa(jatm,katm) + vee(katm,jatm,ksh,jsh)
!write(*,*)'add3',katm,jatm,ksh,jsh,vee(katm,jatm,ksh,jsh)
               end do
            endif
         end do
      end do
   end do
!write(*,*)vaa
   vaa = 2625.5d0*vaa
   totvaa = sum(vaa)
   totvaa = 0.5d0*totvaa
   write(*,*)' '
   write(*,"(a,f12.3)")' Atom-atom interactions, total kJ/mol = ',totvaa
   write(*,"(a)")'     Center-1  Center-2                        Vaa'
   do katm=1,ncenter
      do jatm=1,katm-1
         write(*,"(2i10,20x,6f12.3)") jatm,katm,vaa(jatm,katm)
      end do
   end do


   call walltime(iwalltime3)
   write(*,"(/,' Calculation took up wall clock time',i10,' s')") iwalltime3-iwalltime2


end subroutine


subroutine eoutatommpl(ifileid,ilabel,maxshell,mshell,shpop,shsig,shbeta,shbeta_rot,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext,dsinfo)
   use defvar
   use util
   integer ifileid,ilabel,i
   integer maxshell
   integer mshell(ncenter)
   real*8 shpop(maxshell,ncenter), shsig(maxshell,ncenter,3,3),shbeta(maxshell,ncenter,3),shbeta_rot(maxshell,ncenter,3), eigvec(3,3), eigval(3) , lmat(3,3), invalpha(3,3), dsinfo
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter)
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4), moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)
   character selectyn,chgfilename*200
   call path2filename(firstfilename,chgfilename)
   if (ilabel.eq.1) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".becke_mpl in current folder? (y/n)"
   if (ilabel.eq.2) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".embis_mpl in current folder? (y/n)"
   if (ilabel.eq.3) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".hi_mpl in current folder? (y/n)"
   if (ilabel.eq.4) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".cembis_mpl in current folder? (y/n)"
   if (ilabel.eq.5) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".aembis_mpl in current folder? (y/n)"
   read(*,*) selectyn
   if (selectyn=="y".or.selectyn=="Y") then
      if (ilabel.eq.1) open(ifileid,file=trim(chgfilename)//".becke_mpl",status="replace")
      if (ilabel.eq.2) open(ifileid,file=trim(chgfilename)//".embis_mpl",status="replace")
      if (ilabel.eq.3) open(ifileid,file=trim(chgfilename)//".hi_mpl",status="replace")
      if (ilabel.eq.4) open(ifileid,file=trim(chgfilename)//".cembis_mpl",status="replace")
      if (ilabel.eq.5) open(ifileid,file=trim(chgfilename)//".aembis_mpl",status="replace")

      !       calculate normalizations for printing
      tsum1 = sum(achg(1,:))
      tsum2 = sum(achg(2,:))

      write(ifileid,*)' All multipoles in atomic units'
      write(ifileid,*)' '

      write(ifileid,*)' Atomic coordinates, Bohr'
      do i=1,ncenter
         write(ifileid,"(a,3f15.8)") a(i)%name,a(i)%x,a(i)%y,a(i)%z
      end do
      write(ifileid,*)' '

      write(ifileid,*)' Atomic charges, un-normalized, normalized, Ss being the sum'
      do i=1,ncenter
         write(ifileid,"(a,2f15.8)") a(i)%name,achg(1,i),achg(2,i)
      end do
      write(ifileid,"(a,2f15.8)")'Ss',tsum1,tsum2
      write(ifileid,*)' Atomic dipoles, in order x, y, z'
      do i=1,ncenter
         write(ifileid,"(a,3f15.8)") a(i)%name,(adip(j,i),j=1,3)
      end do
      write(ifileid,*)' Atomic quadrupoles, Cartesian form, in order xx, xy, xz, yy, yz, zz'
      do i=1,ncenter
         write(ifileid,"(a,6f15.8)") a(i)%name,(aquad(j,i),j=1,6)
      end do
      write(ifileid,*)' Atomic quadrupoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,6f15.8)") a(i)%name,(aquadt(j,i),j=1,6)
      end do
      write(ifileid,"(a)")' Atomic octupoles, Cartesian form, in order: xxx, xxy, xxz, xyy, xyz, xzz, yyy, yyz, yzz, zzz'
      do i=1,ncenter
         write(ifileid,"(a,10f10.4)") a(i)%name,(aoct(j,i),j=1,10)
      end do
      write(ifileid,*)' Atomic octupoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,10f10.4)") a(i)%name,(aoctt(j,i),j=1,10)
      end do
      write(ifileid,"(a)")' Atomic hexadecapoles, Cartesian form, in order: xxxx, xxxy, xxxz, xxyy, xxyz, xxzz, xyyy, xyyz, xyzz, xzzz, yyyy, yyyz, yyzz, yzzz, zzzz'
      do i=1,ncenter
         write(ifileid,"(a,15f10.4)") a(i)%name,(ahex(j,i),j=1,15)
      end do
      write(ifileid,*)' Atomic hexadecapoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,15f10.4)") a(i)%name,(ahext(j,i),j=1,15)
      end do
      write(ifileid,*)' '
      write(ifileid,*)' Atomic to molecular condensed quantities'
      write(ifileid,"(a,f15.8)")'  Molecular charge',mchg
      write(ifileid,*)' Dipole contributions: Atomic rank 0, 1, molecular, exact'
      write(ifileid,*)' Order: x, y, z, norm'
      do i=1,3
         write(ifileid,"(i5,3f15.8,5x,f15.8)")i-1,(mdip(j,i),j=1,3),dsqrt(mdip(1,i)**2+mdip(2,i)**2+mdip(3,i)**2)
      end do
      write(ifileid,"(i5,3f15.8,5x,f15.8)")9,(moldipol(j),j=1,3),dsqrt(moldipol(1)**2+moldipol(2)**2+moldipol(3)**2)

      write(ifileid,*)' Cartesian Quadrupole contributions: Atomic rank 0, 1, 2, molecular, exact'
      write(ifileid,*)' Order: xx, xy, xz, yy, yz, zz, norm'
      do i=1,4
         write(ifileid,"(i5,6f15.8,5x,f15.8)")i-1,(mquad(j,i),j=1,6),dsqrt(mquad(1,i)**2+mquad(2,i)**2+mquad(3,i)**2+mquad(4,i)**2+mquad(5,i)**2+mquad(6,i)**2)
      end do
      write(ifileid,"(i5,6f15.8,5x,f15.8)")9,(molquad(j),j=1,6),dsqrt(molquad(1)**2+molquad(2)**2+molquad(3)**2+molquad(4)**2+molquad(5)**2+molquad(6)**2)
      write(ifileid,*)' Traceless Quadrupole contributions: Atomic rank 0, 1, 2, molecular, exact'
      do i=1,4
         write(ifileid,"(i5,6f15.8,5x,f15.8)")i-1,(mquadt(j,i),j=1,6),dsqrt(mquadt(1,i)**2+mquadt(2,i)**2+mquadt(3,i)**2+mquadt(4,i)**2+mquadt(5,i)**2+mquadt(6,i)**2)

      end do
      write(ifileid,"(i5,6f15.8,5x,f15.8)")9,(molquadt(j),j=1,6),dsqrt(molquadt(1)**2+molquadt(2)**2+molquadt(3)**2+molquadt(4)**2+molquadt(5)**2+molquadt(6)**2)
      write(ifileid,*)' Cartesian Octupole contributions: Atomic rank 0, 1, 2, 3, molecular, exact'
      write(ifileid,"(a)")' Order: xxx, xxy, xxz, xyy, xyz, xzz, yyy, yyz, yzz, zzz'
      do i=1,5
         write(ifileid,"(i5,10f10.3)")i-1,(moct(j,i),j=1,10)
      end do
      write(ifileid,"(i5,10f10.3)")9,(moloct(j),j=1,10)
      write(ifileid,*)' Traceless Octupole contributions: Atomic rank 0, 1, 2, 3, molecular, exact'
      do i=1,5
         write(ifileid,"(i5,10f10.3)")i-1,(moctt(j,i),j=1,10)
      end do
      write(ifileid,"(i5,10f10.3)")9,(moloctt(j),j=1,10)

      write(ifileid,"(a)")' Cartesian Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, molecular, exact'
      write(ifileid,"(a)")' Order: xxxx, xxxy, xxxz, xxyy, xxyz, xxzz, xyyy, xyyz, xyzz, xzzz, yyyy, yyyz, yyzz, yzzz, zzzz'
      do i=1,6
         write(ifileid,"(i5,15f10.2)")i-1,(mhex(j,i),j=1,15)
      end do
      write(ifileid,"(i5,15f10.2)")9,(molhex(j),j=1,15)
      write(ifileid,"(a)")' Traceless Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, molecular, exact'
      do i=1,6
         write(ifileid,"(i5,15f10.2)")i-1,(mhext(j,i),j=1,15)
      end do
      write(ifileid,"(i5,15f10.2)")9,(molhext(j),j=1,15)
      
      write(ifileid,*)' '
      write(ifileid,"(a,f15.8)")' MBIS dS-Info = ',dsinfo

      write(ifileid,*)' '
      write(ifileid,*)'EMBIS parameters:'
      write(ifileid,'(a)')'  Atom  Number Shell   Npop           Alpha: xx xy xz yy yz zz                                                 Isotropic    Anisotropy sqrt(Isotropic) '
      do i=1,ncenter
         do j=1,mshell(i)
            lmat=0
            lmat(:,:)=shsig(j,i,:,:)
            call diagsymat(lmat,eigvec,eigval,istat)
            if (istat.ne.0)write(*,*)'Alpha diagonalization problem'
!                        call diagmat(lmat,eigvec,eigval,100,1.0d-8)
            write(ifileid,"(5x,a,2i5,f15.8,6f12.6,5x,3f12.6)")a(i)%name,i,j,shpop(j,i),shsig(j,i,1,1),shsig(j,i,1,2),shsig(j,i,1,3),shsig(j,i,2,2),shsig(j,i,2,3),shsig(j,i,3,3),(sum(eigval)/3),(maxval(eigval)-minval(eigval))/(sum(eigval)/3),sqrt((sum(eigval)/3))
         end do
      end do

      write(ifileid,*)' '
      write(ifileid,*) 'Alpha eigen-values and -vectors'
      write(ifileid,'(a)')'  Atom  Number Shell  lamda-1     x-vec-1   y-vec-1   z-vec-1        lamda-2     x-vec-2   y-vec-2   z-vec-2        lamda-3     x-vec-3   y-vec-3   z-vec-3'
      do i=1,ncenter
         do j=1,mshell(i)
            lmat=0
            lmat(:,:)=shsig(j,i,:,:)
            call diagsymat(lmat,eigvec,eigval,istat)
            if (istat.ne.0)write(*,*)'Alpha diagonalization problem'
!                call diagmat(lmat,eigvec,eigval,100,1.0d-8)
            write(ifileid,"(5x,a,2i5,3(f12.5,2x,3f10.5,3x))")a(i)%name,i,j,eigval(1),eigvec(1,1),eigvec(2,1),eigvec(3,1),eigval(2),eigvec(1,2),eigvec(2,2),eigvec(3,2),eigval(3),eigvec(1,3),eigvec(2,3),eigvec(3,3)
         end do
      end do
      if (any(shbeta /= 0.0d0)) then
         write(ifileid,*)
         write(ifileid,*)'AEMBIS parameters:'
         write(ifileid,*) "Beta vector of each shell (Bohr^-1)"
         do iatm=1,ncenter
            do ish=1,mshell(iatm)
               ! Printing the 3 components of the beta vector on one line
               write(ifileid,"(i5,'(',a,') Shell',i2,':',3f12.6)") &
                  iatm, a(iatm)%name, ish, shbeta_rot(ish,iatm,:)
            end do
         end do

         write(ifileid,*)
         write(ifileid,*) "Beta vector of each shell in xyz coordinate system (Bohr^-1)"
         do iatm=1,ncenter
            do ish=1,mshell(iatm)
               ! Printing the 3 components of the beta vector on one line
               write(ifileid,"(i5,'(',a,') Shell',i2,':',3f12.6)") &
                  iatm, a(iatm)%name, ish, shbeta(ish,iatm,:)
            end do
         end do

         write(ifileid,*)
         write(ifileid,*) "(betaT alpha-1 beta) of each shell"
         do iatm=1,ncenter
            do ish=1,mshell(iatm)
               invalpha(:,:) = invmat(shsig(ish,iatm,:,:),3)
               write(ifileid,"(i5,'(',a,') Shell',i2,':',3f12.6)") &
                  iatm, a(iatm)%name, ish, dot_product(shbeta(ish,iatm,:),matmul(invalpha,shbeta(ish,iatm,:)))
            end do
         end do
      endif


      close(ifileid)
      if (ilabel.eq.1)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".becke_mpl in current folder"
      if (ilabel.eq.2)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".embis_mpl in current folder"
      if (ilabel.eq.3)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".hi_mpl in current folder"
      if (ilabel.eq.4)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".cembis_mpl in current folder"
      if (ilabel.eq.5)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".aembis_mpl in current folder"
      write(*,"(a)") " First (unormalized) charges, then dipoles (x,y,z), then Cartesian quadrupoles (xx,xy,xz,yy,yz,zz), then Traceless quadrupoles"
      write(*,"(a)") "  then Cartesian octupole (xxx,xxy,xxz,xyy,xyz,xzz,yyy,yyz,yzz,zzz), then Traceless octupole"
      write(*,"(a)") "  then Cartesian hexadecapole (xxxx,xxxy,xxxz,xxyy,xxyz,xxzz,xyyy,xyyz,xyzz,xzzz,yyyy,yyyz,yyzz,yzzz,zzzz), then Traceless hexadecapole, units are au"
      write(*,"(a)") " Then the atom to molecule condensed quantities"
   end if
end subroutine

subroutine outatommpl(ifileid,ilabel,maxshell,mshell,shpop,shsig,achg,adip,aquad,aquadt,aoct,aoctt,ahex,ahext,mchg,mdip,mquad,mquadt,moct,moctt,mhex,mhext,moldipol,molquad,molquadt,moloct,moloctt,molhex,molhext)
   use defvar
   use util
   integer ifileid,ilabel,i
   integer maxshell
   integer mshell(ncenter)
   real*8 shpop(maxshell,ncenter), shsig(maxshell,ncenter)
   real*8 achg(2,ncenter), adip(3,ncenter), aquad(6,ncenter), aquadt(6,ncenter)
   real*8 aoct(10,ncenter), aoctt(10,ncenter), ahex(15,ncenter), ahext(15,ncenter)
   real*8 mchg, mdip(3,3), mquad(6,4), mquadt(6,4), moct(10,5), moctt(10,5), mhex(15,6), mhext(15,6)
   real*8 moldipol(3),molquad(6),molquadt(6),moloct(10),moloctt(10),molhex(15),molhext(15)
   character selectyn,chgfilename*200
   call path2filename(firstfilename,chgfilename)
   if (ilabel.eq.1) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".becke_mpl in current folder? (y/n)"
   if (ilabel.eq.2) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".mbis_mpl in current folder? (y/n)"
   if (ilabel.eq.3) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".hi_mpl in current folder? (y/n)"
   if (ilabel.eq.4) write(*,"(a)") " Output atomic multipoles to "//trim(chgfilename)//".cmbis_mpl in current folder? (y/n)"
   read(*,*) selectyn
   if (selectyn=="y".or.selectyn=="Y") then
      if (ilabel.eq.1) open(ifileid,file=trim(chgfilename)//".becke_mpl",status="replace")
      if (ilabel.eq.2) open(ifileid,file=trim(chgfilename)//".mbis_mpl",status="replace")
      if (ilabel.eq.3) open(ifileid,file=trim(chgfilename)//".hi_mpl",status="replace")
      if (ilabel.eq.4) open(ifileid,file=trim(chgfilename)//".cmbis_mpl",status="replace")

      !       calculate normalizations for printing
      tsum1 = sum(achg(1,:))
      tsum2 = sum(achg(2,:))

      write(ifileid,*)' All multipoles in atomic units'
      write(ifileid,*)' '

      write(ifileid,*)' Atomic coordinates, Bohr'
      do i=1,ncenter
         write(ifileid,"(a,3f15.8)") a(i)%name,a(i)%x,a(i)%y,a(i)%z
      end do
      write(ifileid,*)' '

      write(ifileid,*)' Atomic charges, un-normalized, normalized, Ss being the sum'
      do i=1,ncenter
         write(ifileid,"(a,2f15.8)") a(i)%name,achg(1,i),achg(2,i)
      end do
      write(ifileid,"(a,2f15.8)")'Ss',tsum1,tsum2
      write(ifileid,*)' Atomic dipoles, in order x, y, z'
      do i=1,ncenter
         write(ifileid,"(a,3f15.8)") a(i)%name,(adip(j,i),j=1,3)
      end do
      write(ifileid,*)' Atomic quadrupoles, Cartesian form, in order xx, xy, xz, yy, yz, zz'
      do i=1,ncenter
         write(ifileid,"(a,6f15.8)") a(i)%name,(aquad(j,i),j=1,6)
      end do
      write(ifileid,*)' Atomic quadrupoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,6f15.8)") a(i)%name,(aquadt(j,i),j=1,6)
      end do
      write(ifileid,"(a)")' Atomic octupoles, Cartesian form, in order: xxx, xxy, xxz, xyy, xyz, xzz, yyy, yyz, yzz, zzz'
      do i=1,ncenter
         write(ifileid,"(a,10f10.4)") a(i)%name,(aoct(j,i),j=1,10)
      end do
      write(ifileid,*)' Atomic octupoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,10f10.4)") a(i)%name,(aoctt(j,i),j=1,10)
      end do
      write(ifileid,"(a)")' Atomic hexadecapoles, Cartesian form, in order: xxxx, xxxy, xxxz, xxyy, xxyz, xxzz, xyyy, xyyz, xyzz, xzzz, yyyy, yyyz, yyzz, yzzz, zzzz'
      do i=1,ncenter
         write(ifileid,"(a,15f10.4)") a(i)%name,(ahex(j,i),j=1,15)
      end do
      write(ifileid,*)' Atomic hexadecapoles, Traceless form'
      do i=1,ncenter
         write(ifileid,"(a,15f10.4)") a(i)%name,(ahext(j,i),j=1,15)
      end do
      write(ifileid,*)' '
      write(ifileid,*)' Atomic to molecular condensed quantities'
      write(ifileid,"(a,f15.8)")'  Molecular charge',mchg
      write(ifileid,*)' Dipole contributions: Atomic rank 0, 1, molecular, exact'
      write(ifileid,*)' Order: x, y, z, norm'
      do i=1,3
         write(ifileid,"(i5,3f15.8,5x,f15.8)")i-1,(mdip(j,i),j=1,3),dsqrt(mdip(1,i)**2+mdip(2,i)**2+mdip(3,i)**2)
      end do
      write(ifileid,"(i5,3f15.8,5x,f15.8)")9,(moldipol(j),j=1,3),dsqrt(moldipol(1)**2+moldipol(2)**2+moldipol(3)**2)

      write(ifileid,*)' Cartesian Quadrupole contributions: Atomic rank 0, 1, 2, molecular, exact'
      write(ifileid,*)' Order: xx, xy, xz, yy, yz, zz, norm'
      do i=1,4
         write(ifileid,"(i5,6f15.8,5x,f15.8)")i-1,(mquad(j,i),j=1,6),dsqrt(mquad(1,i)**2+mquad(2,i)**2+mquad(3,i)**2+mquad(4,i)**2+mquad(5,i)**2+mquad(6,i)**2)
      end do
      write(ifileid,"(i5,6f15.8,5x,f15.8)")9,(molquad(j),j=1,6),dsqrt(molquad(1)**2+molquad(2)**2+molquad(3)**2+molquad(4)**2+molquad(5)**2+molquad(6)**2)
      write(ifileid,*)' Traceless Quadrupole contributions: Atomic rank 0, 1, 2, molecular, exact'
      do i=1,4
         write(ifileid,"(i5,6f15.8,5x,f15.8)")i-1,(mquadt(j,i),j=1,6),dsqrt(mquadt(1,i)**2+mquadt(2,i)**2+mquadt(3,i)**2+mquadt(4,i)**2+mquadt(5,i)**2+mquadt(6,i)**2)

      end do
      write(ifileid,"(i5,7f15.8)")9,(molquadt(j),j=1,6),dsqrt(molquadt(1)**2+molquadt(2)**2+molquadt(3)**2+molquadt(4)**2+molquadt(5)**2+molquadt(6)**2)

      write(ifileid,*)' Cartesian Octupole contributions: Atomic rank 0, 1, 2, 3, molecular, exact'
      write(ifileid,"(a)")' Order: xxx, xxy, xxz, xyy, xyz, xzz, yyy, yyz, yzz, zzz'
      do i=1,5
         write(ifileid,"(i5,10f10.3)")i-1,(moct(j,i),j=1,10)
      end do
      write(ifileid,"(i5,10f10.3)")9,(moloct(j),j=1,10)
      write(ifileid,*)' Traceless Octupole contributions: Atomic rank 0, 1, 2, 3, molecular, exact'
      do i=1,5
         write(ifileid,"(i5,10f10.3)")i-1,(moctt(j,i),j=1,10)
      end do
      write(ifileid,"(i5,10f10.3)")9,(moloctt(j),j=1,10)

      write(ifileid,"(a)")' Cartesian Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, molecular, exact'
      write(ifileid,"(a)")' Order: xxxx, xxxy, xxxz, xxyy, xxyz, xxzz, xyyy, xyyz, xyzz, xzzz, yyyy, yyyz, yyzz, yzzz, zzzz'
      do i=1,6
         write(ifileid,"(i5,15f10.2)")i-1,(mhex(j,i),j=1,15)
      end do
      write(ifileid,"(i5,15f10.2)")9,(molhex(j),j=1,15)
      write(ifileid,"(a)")' Traceless Hexdecapole contributions: Atomic rank 0, 1, 2, 3, 4, molecular, exact'
      do i=1,6
         write(ifileid,"(i5,15f10.2)")i-1,(mhext(j,i),j=1,15)
      end do
      write(ifileid,"(i5,15f10.2)")9,(molhext(j),j=1,15)

      write(ifileid,*)' '
      write(ifileid,*)' MBIS parameters'
      write(ifileid,'(a)')'  Atom  Number Shell   Npop           Sigma          1/Sigma'
      do i=1,ncenter
         do j=1,mshell(i)
            write(ifileid,"(5x,a,2i5,3f15.8)") a(i)%name,i,j,shpop(j,i),shsig(j,i),1.0d0/shsig(j,i)
         end do
      end do
      close(ifileid)
      if (ilabel.eq.1)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".becke_mpl in current folder"
      if (ilabel.eq.2)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".mbis_mpl in current folder"
      if (ilabel.eq.3)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".hi_mpl in current folder"
      if (ilabel.eq.4)write(*,"(a)") " Atomic multipoles have been saved to "//trim(chgfilename)//".cmbis_mpl in current folder"
      write(*,"(a)") " First (unormalized) charges, then dipoles (x,y,z), then Cartesian quadrupoles (xx,xy,xz,yy,yz,zz), then Traceless quadrupoles"
      write(*,"(a)") "  then Cartesian octupole (xxx,xxy,xxz,xyy,xyz,xzz,yyy,yyz,yzz,zzz), then Traceless octupole"
      write(*,"(a)") "  then Cartesian hexadecapole (xxxx,xxxy,xxxz,xxyy,xxyz,xxzz,xyyy,xyyz,xyzz,xzzz,yyyy,yyyz,yyzz,yzzz,zzzz), then Traceless hexadecapole, units are au"
      write(*,"(a)") " Then the atom to molecule condensed quantities"
   end if
end subroutine