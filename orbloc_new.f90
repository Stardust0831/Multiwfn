!!------------------------------------------------------
!! ----------- Orbital localization analysis ----------- 
!!------------------------------------------------------
!The final wavefunction can be exported as .fch, I don't select .molden because it doesn't record atomic charge, this will be problematic when ECP is used
subroutine orbloc
use defvar
use util
use functions
use, intrinsic :: iso_fortran_env, only: int64
implicit real*8 (a-h,o-z)
character c2000tmp*2000
integer :: maxcyc=80,ireload=1,idoene=0,idocore=1,imethod=1,domark(4),iPMexp=2,ilmocen=0
real*8 :: arrayi(nbasis),arrayj(nbasis),crit=1D-4,tmpbasarr(nbasis),tmpprimarr(nprims),bastot(nbasis)
real*8,pointer :: Cmat(:,:)
real*8,allocatable :: FLMOA(:,:),FLMOB(:,:),Xmat(:,:),Xmatinv(:,:),AOMbas(:,:,:),tmpmat(:,:)
real*8 :: orbcomp(ncenter,nbasis) !Used in printing major orbital character
integer :: orbtype(nmo) !LMO type determined according to composition, 0=other, 1=one-center, 2=two-center
integer :: orbatm(2,nmo) !The index of the atom mainly involved in the LMO. one-center LMO has first element, two-center LMO has two elements
integer :: istatarr(nbasis),iatmarr(ncenter,nbasis) !Used in printing major orbital character
real*8 :: irj(3),iri(3),jrj(3) !Used for Boys localization, store dipole moment integral between two orbitals
real*8 :: crit1c=0.85D0,crit2c=0.80D0
integer :: thres_1c=90,thres_2c=85,icompmethod=2
character c200tmp*200,typestr*4,selectyn
integer orblist(nmo),norblist !Record the index of MOs included in the localization
integer orblist_did(nmo) !If the orbital is involved in orbital localization, it will be set to 1, otherwise 0
!Used by optimized OpenMP PM-Mulliken / PM-Lowdin localization
integer :: natm_act,nwords,neven,nhalf,iround,ipair,iw,iw_beg,iw_end,ibit,ia
integer,allocatable :: atm_start(:),atm_end(:),top_orb(:),bot_orb(:),iw_min(:),iw_max(:)
integer(int64),allocatable :: pm_mask(:,:)
integer(int64) :: bits
logical :: has_ovl
real*8,allocatable :: Cact(:,:),SCact(:,:),Qdiag(:,:),P_orb(:)
real*8 :: r_tol2,gam_tol,cg,sg,tmp1,tmp2
!Used by optimized OpenMP PM-Becke / Foster-Boys localization (MO-basis Jacobi)
integer :: nmat,iexp,idir,imat,irot,irow,icol,n_rot
integer,allocatable :: rot_i(:),rot_j(:)
logical,allocatable :: pair_rot(:)
real*8,allocatable :: Omo(:,:,:),Umat(:,:),AOMtmp(:,:),Omo_slice(:,:),Dtmp(:,:),Ctmp(:,:)
real*8,allocatable :: pair_c(:),pair_s(:),rot_c(:),rot_s(:)
real*8 :: ravg
!Used by PM-Becke
real*8 tmprow(1,nbasis),mat11(1,1),veccoeffi(1,nbasis),veccoeffj(1,nbasis)
!Used by semi-localization methods (imethod=21..24)
integer :: islmo_pop=1,islmo_Htype=1,islmo_clust=1,islmo_m=4,isel_slmo,nmat_Q
real*8 :: slmo_w0=0.025D0,slmo_lamsep=10D0,slmo_eps0=0.045D0,slmo_lamH=250D0,slmo_tau=0.015D0,slmo_Bcut=0.03D0
logical :: has_Fmat,fock_ok
integer,allocatable :: atm_id(:)
real*8,allocatable :: Qmo(:,:,:),Fmat_mo(:,:)
!Below for calculating LMO centers and dipole moments
real*8,allocatable :: orbvalpt(:,:)
real*8 LMOpos(3,nmo),tmpvec(3)
real*8 beckeweigrid(radpot*sphpot)
type(content) gridatm(radpot*sphpot),gridatmorg(radpot*sphpot)

if (wfntype==2.or.wfntype==3.or.wfntype==4) then
	write(*,*) "Error: This function only works for single-determinant SCF wavefunction!"
	write(*,*) "Press ENTER button to return"
	read(*,*)
	return
end if
if (.not.allocated(CObasa)) then
	write(*,*) "Error: Basis function information was not provided by your input file!"
	write(*,*) "Press ENTER button to return"
	read(*,*)
	return
end if

do while(.true.)
	write(*,*)
	write(*,*) "                ======== Orbital localization analysis ========"
	if (imethod>=21.and.imethod<=24) then
		if (islmo_pop==1) write(*,*) "-11 Set parameters for semi-localization, current pop: Lowdin"
		if (islmo_pop==2) write(*,*) "-11 Set parameters for semi-localization, current pop: Becke"
	end if
	if (icompmethod>0) write(*,"(a,2i4,' %')") " -10 Set threshold for determining one- and two-center LMO, current:",nint(crit1c*100),nint(crit2c*100)
    if (icompmethod==0) write(*,*) "-9 Set the method for calculating orbital composition, current: Do not calculate"
    if (icompmethod==1) write(*,*) "-9 Set the method for calculating orbital composition, current: Mulliken+SCPA"
    if (icompmethod==2) write(*,*) "-9 Set the method for calculating orbital composition, current: Hirshfeld"
    if (icompmethod==3) write(*,*) "-9 Set the method for calculating orbital composition, current: Becke"
	if (ilmocen==1) write(*,*) "-8 If calculating center position and dipole moment of LMOs, current: Yes"
	if (ilmocen==0) write(*,*) "-8 If calculating center position and dipole moment of LMOs, current: No"
	!By default exponent of 2 is used for PM. Exponent of 4 can also be chosen by option -7.
    !According to my test, p=4 converges slower than p=2 for PM-Mulliken and PM-Lowdin,
    !and the degree of localization is not as substantial as p=2, so I finally decide not to expose this option to users
! 	if (imethod==1.or.imethod==2.or.imethod==3) write(*,"(a,i3)") " -7 Set exponent of Pipek-Mezey method, current:",iPMexp
	if (imethod==1) write(*,*) "-6 Set localization method, current: Pipek-Mezey with Mulliken population"
	if (imethod==2) write(*,*) "-6 Set localization method, current: Pipek-Mezey with Lowdin population"
	if (imethod==3) write(*,*) "-6 Set localization method, current: Pipek-Mezey with Becke population"
	if (imethod==10) write(*,*) "-6 Set localization method, current: Foster-Boys"
	if (imethod==21) write(*,*) "-6 Set localization method, current: Semi-localized Omega-F-PM (simultaneous, Fock)"
	if (imethod==22) write(*,*) "-6 Set localization method, current: Semi-localized Omega-HBO-PM (simultaneous, Fock-free)"
	if (imethod==23) write(*,*) "-6 Set localization method, current: Semi-localized PM-GSC (PM + M_ij graph block diag.)"
	if (imethod==24) write(*,*) "-6 Set localization method, current: Semi-localized Spectral Omega-Split + Island PM"
	if (idocore==1) write(*,*) "-5 If also localizing core orbitals, current: Yes"
	if (idocore==0) write(*,*) "-5 If also localizing core orbitals, current: No"
	if (idoene==1) write(*,*) "-4 If calculating and printing orbital energies, current: Yes"
	if (idoene==0) write(*,*) "-4 If calculating and printing orbital energies, current: No"
	if (ireload==1) write(*,*) "-3 If reloading newly generated .fch file, current: Yes"
	if (ireload==0) write(*,*) "-3 If reloading newly generated .fch file, current: No"
	write(*,"(a,f12.8)") " -2 Set criterion of convergence, current:",crit
	write(*,"(a,i4)") " -1 Set maximum cycles, current:",maxcyc
	write(*,*) "0 Return"
	write(*,*) "1 Localizing occupied orbitals only"
	write(*,*) "2 Localizing both occupied and unoccupied orbitals separately"
	write(*,*) "3 Localizing specific set of orbitals"
	read(*,*) isel
    
	if (isel==0) then
		return
	else if (isel==-1) then
		write(*,*) "Input maximum cycles, e.g. 30"
		read(*,*) maxcyc
	else if (isel==-2) then
		write(*,*) "Input criterion of convergence, e.g. 0.0001"
		read(*,*) crit
	else if (isel==-3) then
		if (ireload==1) then
			ireload=0
		else if (ireload==0) then
			ireload=1
		end if
	else if (isel==-4) then
		if (idoene==1) then
			idoene=0
		else if (idoene==0) then
			do while(.true.)
				write(*,*)
				write(*,*) "How to evaluate energy of localized orbitals?"
				write(*,*) "0 Do not evaluate"
				write(*,*) "1 Evaluate, using the Fock matrix generated by MO energies and coefficients"
				write(*,*) "2 Evaluate, loading Fock matrix from a file"
				read(*,*) ievalene
				if (ievalene==0) then
					exit
				else if (ievalene==1) then
					call MOene2Fmat(istatus)
				else if (ievalene==2) then
					call loadFockfile(istatus)
				end if
				if (istatus==0) then
					idoene=1
					exit
                end if
			end do
		end if
	else if (isel==-5) then
		if (idocore==1) then
			idocore=0
		else if (idocore==0) then
			idocore=1
		end if
	else if (isel==-6) then
		write(*,*) "Please select orbital localization method"
		if (ifPBC==0) write(*,"(a,/)") " Hint: 1 and 2 are very fast, but may not well work when diffuse functions are presented. 10 &
        &is evidently slower, and 3 is quite time-consuming for large systems, but they are fully compatible &
        &with diffuse functions. Only 10 is unable to give sigma-pi separated LMOs"
		write(*,*) "1 Pipek-Mezey based on Mulliken type of population"
		write(*,*) "2 Pipek-Mezey based on Lowdin type of population"
        if (ifPBC==0) then
			write(*,*) "3 Pipek-Mezey based on Becke population"
			write(*,*) "10 Foster-Boys"
        end if
		write(*,*) "--- Semi-localization methods (preserve multicenter electronic delocalization) ---"
		write(*,*) "21 Frustration-gated Pipek-Mezey with Fock operator (Omega-F-PM, simultaneous)"
		write(*,*) "22 Frustration-gated Pipek-Mezey with bond-order operator (Omega-HBO-PM, Fock-free)"
		write(*,*) "23 PM delocalization-graph block semi-canonicalization (PM-GSC)"
		write(*,*) "24 Spectral Omega-split + island semi-localization (Omega-Split)"
		read(*,*) imethod
		if (imethod>=21.and.imethod<=24) then
			if (ifPBC/=0) islmo_pop=1
			write(*,"(a)") " Note: Use option -11 to select population basis (Lowdin/Becke) and adjust semi-localization parameters"
		end if
	else if (isel==-7) then
		write(*,*) "Input exponent of Pipek-Mezey method. 2 or 4 is allowed"
		write(*,"(a)") " Note: Original paper of PM method use exponent of 2, while 4 is shown to give LMO with more localized character"
		read(*,*) iPMexp
		if (iPMexp/=2.and.iPMexp/=4) then
			write(*,*) "Input error! The value should be either 2 or 4!"
			write(*,*) "Press ENTER button to continue"
			read(*,*)
			iPMexp=2
		end if
	else if (isel==-8) then
		if (ilmocen==0) then
			if (ireload==0) then
				write(*,"(a)") " Error: To use this function, you must first switch the option ""If reloading newly generated .fch file"" to ""Yes"""
				write(*,*) "Press ENTER button to continue"
				read(*,*)
				cycle
			end if
			ilmocen=1
		else if (ilmocen==1) then
			ilmocen=0
		end if
    else if (isel==-9) then
        !Sometimes SCPA tends to overestimate delocalization character of lone pair type of LMO, &
        !while Mulliken method tends to result in extremely large atomic composition for virtual LMOs
        write(*,"(a,/)") " Hint: Option 1 is very fast, however the method is not robust, and it is even useless when diffuse functions are employed. &
        &Options 2 and 3 usually give similar result, they are more expensive, but fully compatible with diffuse functions"
        write(*,*) "0 Do not calculate orbital compositions"
        write(*,*) "1 Mulliken method for occupied LMOs and SCPA method for unoccupied LMOs"
        write(*,*) "2 Hirshfeld method"
        write(*,*) "3 Becke method"
        read(*,*) icompmethod
	else if (isel==-10) then
		write(*,"(a)") " Input thresholds for identifying one- and two-center LMOs. For example, &
		&inputting 0.9,0.85 means using 90% and 85%, respectively"
		read(*,*) crit1c,crit2c

	else if (isel==-11.and.imethod>=21.and.imethod<=24) then
		do while(.true.)
			write(*,*)
			write(*,*) " --- Semi-localization settings ---"
			write(*,*) "0 Return"
			if (islmo_pop==1) write(*,*) "1 Atomic population basis, current: Lowdin (fast; use Becke for diffuse basis)"
			if (islmo_pop==2) write(*,*) "1 Atomic population basis, current: Becke (diffuse-basis safe; slower)"
			if (imethod==21.or.imethod==22) then
				write(*,"(a,f10.5)") " 2 Frustration gate threshold w0, current:",slmo_w0
				write(*,"(a,i4)") " 3 Frustration gate sharpness exponent m, current:",islmo_m
				write(*,"(a,f10.3)") " 4 Subspace separation weight lambda_sep, current:",slmo_lamsep
				if (imethod==21) then
					write(*,"(a,f10.5,' Ha (',f6.2,' eV, lam_F=',f9.1,')')") &
						" 5 Delocalization energy cutoff eps0, current:",slmo_eps0,slmo_eps0*au2eV,1D0/(slmo_eps0*slmo_eps0)
				else
					write(*,"(a,f10.2)") " 5 Bond-order canonicalization weight lambda_H, current:",slmo_lamH
				end if
			else if (imethod==23) then
				write(*,"(a,f10.5)") " 2 Orbital-pair coupling threshold tau (on M_ij), current:",slmo_tau
				if (islmo_Htype==1) write(*,*) "3 Intra-cluster operator, current: Fock/MO energies (auto fallback to H_BO)"
				if (islmo_Htype==2) write(*,*) "3 Intra-cluster operator, current: Bond-order operator H_BO (Fock-free)"
				if (islmo_clust==1) write(*,*) "4 Clustering mode, current: Connected components (M_ij > tau)"
				if (islmo_clust==2) write(*,*) "4 Clustering mode, current: Modularity communities (Clar-sextet style)"
			else if (imethod==24) then
				write(*,"(a,f10.5)") " 2 Omega eigenvalue cutoff w_cut, current:",slmo_w0
				write(*,"(a,f10.5)") " 3 Delocalized-subspace island bond-order threshold B_cut, current:",slmo_Bcut
				if (islmo_Htype==1) write(*,*) "4 Intra-island operator, current: Fock/MO energies (auto fallback to H_BO)"
				if (islmo_Htype==2) write(*,*) "4 Intra-island operator, current: Bond-order operator H_BO (Fock-free)"
			end if
			read(*,*) isel_slmo
			if (isel_slmo==0) then
				exit
			else if (isel_slmo==1) then
				if (ifPBC/=0) then
					write(*,*) "Note: Only Lowdin population is supported for periodic systems"
					islmo_pop=1
				else
					if (islmo_pop==1) then
						islmo_pop=2
					else
						islmo_pop=1
					end if
				end if
			else if (isel_slmo==2) then
				if (imethod==21.or.imethod==22) then
					write(*,*) "Input w0 (recommended: 0.020-0.035; lower includes weaker conjugation):"
					read(*,*) slmo_w0
				else if (imethod==23) then
					write(*,*) "Input tau on M_ij (recommended: 0.012-0.025; higher isolates Clar sextets):"
					read(*,*) slmo_tau
				else if (imethod==24) then
					write(*,*) "Input Omega eigenvalue cutoff w_cut (recommended: 0.020-0.035):"
					read(*,*) slmo_w0
				end if
			else if (isel_slmo==3) then
				if (imethod==21.or.imethod==22) then
					write(*,*) "Input gate sharpness exponent m (even integer, recommended: 4):"
					read(*,*) islmo_m
					if (islmo_m<1) islmo_m=4
				else if (imethod==23) then
					if (islmo_Htype==1) then
						islmo_Htype=2
					else
						islmo_Htype=1
					end if
				else if (imethod==24) then
					write(*,*) "Input delocalized island bond-order cutoff B_cut (recommended: 0.02-0.10):"
					read(*,*) slmo_Bcut
				end if
			else if (isel_slmo==4) then
				if (imethod==21.or.imethod==22) then
					write(*,*) "Input subspace separation weight lambda_sep (recommended: 5.0-20.0):"
					read(*,*) slmo_lamsep
				else if (imethod==23) then
					if (islmo_clust==1) then
						islmo_clust=2
					else
						islmo_clust=1
					end if
				else if (imethod==24) then
					if (islmo_Htype==1) then
						islmo_Htype=2
					else
						islmo_Htype=1
					end if
				end if
			else if (isel_slmo==5) then
				if (imethod==21) then
					write(*,*) "Input energy cutoff eps0 in Hartree (recommended: 0.030-0.055 Ha):"
					read(*,*) slmo_eps0
					if (slmo_eps0<=0D0) slmo_eps0=0.045D0
				else if (imethod==22) then
					write(*,*) "Input dimensionless bond-order weight lambda_H (recommended: 150-350):"
					read(*,*) slmo_lamH
				end if
			end if
		end do
        
	else if (isel==1.or.isel==2) then
		exit
        
	else if (isel==3) then
        write(*,*) "Select type of orbitals"
        if (wfntype==0) then
            write(*,*) "1 Occupied orbitals"
            write(*,*) "2 Unoccupied orbitals"
        else if (wfntype==1) then
            write(*,*) "1 Occupied alpha orbitals"
            write(*,*) "2 Unoccupied alpha orbitals"
            write(*,*) "3 Occupied beta orbitals"
            write(*,*) "4 Unoccupied beta orbitals"
        end if
        read(*,*) iorbtype
        write(*,"(a)") " Input indices of the orbitals to localize, e.g. 2,3,7-10. The range must belong to the type you selected"
        if (iorbtype==3.or.iorbtype==4) write(*,*) "Note: The beta indices are 1 based"
        read(*,"(a)") c2000tmp
        call str2arr(c2000tmp,norblist,orblist)
        exit
	end if
end do

!Will perform Alpha/total-occ, Alpha/total-vir, Beta-occ, Beta-vir, set a label to indicate which part will actually done
domark=0
if (wfntype==0) then
    if (isel==1) then
	    domark(1)=1
	else if (isel==2) then
        domark(1:2)=1
    else if (isel==3) then
        domark(iorbtype)=1
    end if
else if (wfntype==1) then
    if (isel==1) then
	    domark(1)=1
	    domark(3)=1
	else if (isel==2) then
        domark=1
    else if (isel==3) then
        domark(iorbtype)=1
    end if
end if

if (isel/=3.and.idocore==0) then
	call getninnerele(ninnerele,0) !Count the number of inner electrons
	write(*,"(' Note: Lowest',i5,' orbitals are regarded as core orbitals and will not be localized')") ninnerele/2
end if

!Preparation work for specific method
if (imethod==1) then !PM with Mulliken
    call ask_Sbas_PBC
else if (imethod==2) then !PM with Lowdin
	write(*,*) "Performing Lowdin orthonormalization..."
    call ask_Sbas_PBC
	allocate(Xmat(nbasis,nbasis),Xmatinv(nbasis,nbasis))
	call symmorthomat(Sbas,Xmat,Xmatinv)
    CObasa=matmul_blas(Xmat,CObasa,nbasis,nbasis) !Transform coefficient matrix to orthogonalized basis
    if (allocated(CObasb)) CObasb=matmul_blas(Xmat,CObasb,nbasis,nbasis)
	Sbas_org=Sbas
	Sbas=0
	forall (i=1:nbasis) Sbas(i,i)=1
else if (imethod==3) then !PM with Becke
    allocate(AOMbas(nbasis,nbasis,ncenter))
    write(*,*) "Generating atomic overlap matrix of basis functions..."
    call genAOMbas(AOMbas)
else if (imethod==10) then !Foster-Boys
	if (.not.allocated(Dbas)) then
		write(*,*) "Generating electric dipole moment integral matrix..."
		call genDbas_curr
	end if
else if (imethod>=21.and.imethod<=24) then !Semi-localization methods
	if (ifPBC/=0) islmo_pop=1
	if (islmo_pop==1) then !Lowdin population (keep CObasa/CObasb/Sbas in original AO basis)
		write(*,*) "Computing Lowdin orthogonalization matrix S^(1/2)..."
		call ask_Sbas_PBC
		allocate(Xmat(nbasis,nbasis),Xmatinv(nbasis,nbasis))
		call symmorthomat(Sbas,Xmat,Xmatinv)
	else !Becke population
		allocate(AOMbas(nbasis,nbasis,ncenter))
		write(*,*) "Generating atomic overlap matrix of basis functions (Becke)..."
		call genAOMbas(AOMbas)
	end if
end if

call walltime(iwalltime1)

!Carry out localization
!Alpha-occ,Alpha-vir,Beta-occ,Beta-vir
orblist_did=0
natm_act=0
if (imethod==1.or.imethod==2.or.(imethod>=21.and.imethod<=24.and.islmo_pop==1)) then
    natm_act=count(basstart(1:ncenter)>0)
    if (natm_act>0) then
        allocate(atm_start(natm_act),atm_end(natm_act),atm_id(natm_act))
        ia=0
        do iatm=1,ncenter
            if (basstart(iatm)>0) then
                ia=ia+1
                atm_start(ia)=basstart(iatm)
                atm_end(ia)=basend(iatm)
                atm_id(ia)=iatm
            end if
        end do
    end if
else if (imethod>=21.and.imethod<=24.and.islmo_pop==2) then
    if (ncenter>0) then
        allocate(atm_id(ncenter))
        do iatm=1,ncenter
            atm_id(iatm)=iatm
        end do
    end if
end if
do itime=1,4
	if (domark(itime)==0) cycle
	if (itime<=2) then
		Cmat=>CObasa
	else
		Cmat=>CObasb
	end if
    !Set orbital range to deal with. 1 based index for both alpha and beta
    if (isel==1.or.isel==2) then
	    if (itime==1) then
		    nmobeg=1
		    if (idocore==0) nmobeg=ninnerele/2+1
		    nmoend=naelec
	    else if (itime==2) then
		    nmobeg=naelec+1
		    nmoend=nbasis
	    else if (itime==3) then
		    nmobeg=1
		    if (idocore==0) nmobeg=ninnerele/2+1
		    nmoend=nbelec
	    else if (itime==4) then
		    nmobeg=nbelec+1
		    nmoend=nbasis
	    end if
        norblist=nmoend-nmobeg+1
        forall(i=1:norblist) orblist(i)=nmobeg-1+i
    else if (isel==3) then
        continue !orblist has already been defined by user
    end if
    orblist_did(orblist(1:norblist))=1
	
	if (wfntype==0) then
		if (itime==1) write(*,"(/,a)") " Localizing occupied orbitals..."
		if (itime==2) write(*,"(/,a)") " Localizing unoccupied orbitals..."
	else if (wfntype==1) then
		if (itime==1) write(*,"(/,a)") " Localizing alpha occupied orbitals..."
		if (itime==2) write(*,"(/,a)") " Localizing alpha unoccupied orbitals..."
		if (itime==3) write(*,"(/,a)") " Localizing beta occupied orbitals..."
		if (itime==4) write(*,"(/,a)") " Localizing beta unoccupied orbitals..."
	end if

	if (imethod==1.or.imethod==2) then
		if (norblist<=0.or.natm_act<=0) cycle
		allocate(Cact(nbasis,norblist))
		do idx=1,norblist
			Cact(:,idx)=Cmat(:,orblist(idx))
		end do
		if (imethod==1) then
			write(*,*) "Calculating intermediate matrix, please wait..."
			allocate(SCact(nbasis,norblist))
			SCact=matmul_blas(Sbas,Cact,nbasis,norblist,0,0) !Only active orbitals: O(M*B^2) instead of O(B^3)
		else
			allocate(SCact(1,1)) !Dummy allocation so SCact is always allocated in OpenMP shared clause
		end if

		nwords=(natm_act+63)/64
		neven=norblist+mod(norblist,2)
		nhalf=neven/2
		r_tol2=1D-12
		gam_tol=1D-10
		allocate(Qdiag(natm_act,norblist),P_orb(norblist),pm_mask(nwords,norblist), &
		         iw_min(norblist),iw_max(norblist),top_orb(nhalf),bot_orb(nhalf))

		!$OMP parallel do default(none) &
		!$OMP shared(imethod,iPMexp,nbasis,norblist,natm_act,atm_start,atm_end, &
		!$OMP        nwords,r_tol2,Cact,SCact,Qdiag,P_orb,pm_mask,iw_min,iw_max) &
		!$OMP private(idx) num_threads(nthreads)
		do idx=1,norblist
			if (imethod==1) then
				call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
					nwords,r_tol2,Cact(:,idx),SCact(:,idx),Qdiag(:,idx),P_orb(idx), &
					pm_mask(:,idx),iw_min(idx),iw_max(idx))
			else
				call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
					nwords,r_tol2,Cact(:,idx),Cact(:,idx),Qdiag(:,idx),P_orb(idx), &
					pm_mask(:,idx),iw_min(idx),iw_max(idx))
			end if
		end do
		!$OMP end parallel do

		Pvalold=sum(P_orb(1:norblist))
		write(*,"(' Initial P:',f16.8)") Pvalold

		do icyc=1,maxcyc
			do ipair=1,nhalf
				top_orb(ipair)=ipair
				bot_orb(ipair)=neven-ipair+1
			end do

			!$OMP parallel default(none) &
			!$OMP shared(imethod,iPMexp,nbasis,norblist,natm_act,nwords,neven,nhalf, &
			!$OMP        atm_start,atm_end,Cact,SCact,Qdiag,P_orb,pm_mask,iw_min,iw_max, &
			!$OMP        top_orb,bot_orb,r_tol2,gam_tol) &
			!$OMP private(iround,ipair,idx,jdx,iw_beg,iw_end,iw,bits,ibit,ia,is,ie,ibas, &
			!$OMP         has_ovl,Aval,Bval,Qij,Qii,Qjj,gamma,cg,sg,tmp1,tmp2,itmp) &
			!$OMP num_threads(nthreads)
			do iround=1,neven-1
				!$OMP do schedule(guided)
				do ipair=1,nhalf
					idx=top_orb(ipair)
					jdx=bot_orb(ipair)
					if (idx>norblist.or.jdx>norblist) cycle
					iw_beg=max(iw_min(idx),iw_min(jdx))
					iw_end=min(iw_max(idx),iw_max(jdx))
					if (iw_beg>iw_end) cycle

					!Working equation is Journal of Computational Chemistry, 14, 6, 736 (1993)
					!Using exact identity over overlapping atoms S_i \cap S_j from cached P_orb and Qdiag
					if (iPMexp==2) then
						Aval=-0.25D0*(P_orb(idx)+P_orb(jdx))
					else
						Aval=-(P_orb(idx)+P_orb(jdx))
					end if
					Bval=0D0
					has_ovl=.false.

					do iw=iw_beg,iw_end
						bits=iand(pm_mask(iw,idx),pm_mask(iw,jdx))
						do while (bits/=0_int64)
							has_ovl=.true.
							ibit=trailz(bits)
							bits=ibclr(bits,ibit)
							ia=ishft(iw-1,6)+ibit+1
							is=atm_start(ia)
							ie=atm_end(ia)

							Qij=0D0
							if (imethod==1) then !Mulliken population
								do ibas=is,ie
									Qij=Qij+Cact(ibas,jdx)*SCact(ibas,idx)+Cact(ibas,idx)*SCact(ibas,jdx)
								end do
								Qij=0.5D0*Qij
							else !Lowdin population
								do ibas=is,ie
									Qij=Qij+Cact(ibas,idx)*Cact(ibas,jdx)
								end do
							end if

							Qii=Qdiag(ia,idx)
							Qjj=Qdiag(ia,jdx)
							if (iPMexp==2) then
								Aval=Aval+Qij*Qij+0.5D0*Qii*Qjj
								Bval=Bval+Qij*(Qii-Qjj)
							else
								Aval=Aval+6D0*(Qii*Qii+Qjj*Qjj)*Qij*Qij+Qii*Qjj*(Qii*Qii+Qjj*Qjj)
								Bval=Bval+4D0*Qij*(Qii**3-Qjj**3)
							end if
						end do
					end do

					if (.not.has_ovl) cycle
					if (Aval*Aval+Bval*Bval<1D-14) cycle
					gamma=0.25D0*atan2(Bval,-Aval)
					if (abs(gamma)<gam_tol) cycle

					!Rotate idx and jdx in-place by angle gamma
					cg=cos(gamma)
					sg=sin(gamma)
					do ibas=1,nbasis
						tmp1=Cact(ibas,idx)
						tmp2=Cact(ibas,jdx)
						Cact(ibas,idx)=cg*tmp1+sg*tmp2
						Cact(ibas,jdx)=-sg*tmp1+cg*tmp2
					end do
					if (imethod==1) then !For PM-Mulliken, also correspondingly update SCact
						do ibas=1,nbasis
							tmp1=SCact(ibas,idx)
							tmp2=SCact(ibas,jdx)
							SCact(ibas,idx)=cg*tmp1+sg*tmp2
							SCact(ibas,jdx)=-sg*tmp1+cg*tmp2
						end do
					end if

					!Refresh cached Qdiag, P_orb, and screening bitmask for the 2 rotated orbitals
					if (imethod==1) then
						call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
							nwords,r_tol2,Cact(:,idx),SCact(:,idx),Qdiag(:,idx),P_orb(idx), &
							pm_mask(:,idx),iw_min(idx),iw_max(idx))
						call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
							nwords,r_tol2,Cact(:,jdx),SCact(:,jdx),Qdiag(:,jdx),P_orb(jdx), &
							pm_mask(:,jdx),iw_min(jdx),iw_max(jdx))
					else
						call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
							nwords,r_tol2,Cact(:,idx),Cact(:,idx),Qdiag(:,idx),P_orb(idx), &
							pm_mask(:,idx),iw_min(idx),iw_max(idx))
						call calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
							nwords,r_tol2,Cact(:,jdx),Cact(:,jdx),Qdiag(:,jdx),P_orb(jdx), &
							pm_mask(:,jdx),iw_min(jdx),iw_max(jdx))
					end if
				end do
				!$OMP end do

				!$OMP single
				if (nhalf>1) then !Round-robin cyclic shift (keep top_orb(1) fixed)
					itmp=bot_orb(1)
					do ipair=1,nhalf-1
						bot_orb(ipair)=bot_orb(ipair+1)
					end do
					bot_orb(nhalf)=top_orb(nhalf)
					do ipair=nhalf,3,-1
						top_orb(ipair)=top_orb(ipair-1)
					end do
					top_orb(2)=itmp
				end if
				!$OMP end single
			end do
			!$OMP end parallel

			Pval=sum(P_orb(1:norblist))
			deltaPval=Pval-Pvalold
			write(*,"(' Cycle:',i5,'  P:',f16.8,'  Delta P:',f16.8)") icyc,Pval,deltaPval
			if (abs(deltaPval)<crit) exit
			Pvalold=Pval
		end do

		do idx=1,norblist
			Cmat(:,orblist(idx))=Cact(:,idx)
		end do
		deallocate(Cact,SCact,Qdiag,P_orb,pm_mask,iw_min,iw_max,top_orb,bot_orb)
	else if (imethod==3.or.imethod==10) then
		if (norblist<=0) cycle
		if (imethod==3.and.ncenter<=0) cycle
		allocate(Cact(nbasis,norblist))
		do idx=1,norblist
			Cact(:,idx)=Cmat(:,orblist(idx))
		end do

		if (imethod==3) then
			nmat=ncenter
			iexp=iPMexp
			write(*,*) "Transforming atomic overlap matrices to MO basis, please wait..."
			allocate(Omo(nmat,norblist,norblist),AOMtmp(nbasis,norblist),Omo_slice(norblist,norblist))
			do iatm=1,ncenter
				call dgemm('N','N',nbasis,norblist,nbasis,1D0,AOMbas(1,1,iatm),nbasis,Cact,nbasis,0D0,AOMtmp,nbasis)
				call dgemm('T','N',norblist,norblist,nbasis,1D0,Cact,nbasis,AOMtmp,nbasis,0D0,Omo_slice,norblist)
				!$OMP parallel do default(none) shared(Omo,Omo_slice,iatm,norblist) private(idx,jdx) num_threads(nthreads)
				do jdx=1,norblist
					do idx=1,norblist
						Omo(iatm,idx,jdx)=Omo_slice(idx,jdx)
					end do
				end do
				!$OMP end parallel do
			end do
			deallocate(AOMtmp,Omo_slice)
		else !imethod==10 (Foster-Boys)
			nmat=3
			iexp=2
			allocate(Omo(3,norblist,norblist),Dtmp(nbasis,nbasis),AOMtmp(nbasis,norblist),Omo_slice(norblist,norblist))
			do idir=1,3
				Dtmp(:,:)=Dbas(idir,:,:)
				call dgemm('N','N',nbasis,norblist,nbasis,1D0,Dtmp,nbasis,Cact,nbasis,0D0,AOMtmp,nbasis)
				call dgemm('T','N',norblist,norblist,nbasis,1D0,Cact,nbasis,AOMtmp,nbasis,0D0,Omo_slice,norblist)
				!$OMP parallel do default(none) shared(Omo,Omo_slice,idir,norblist) private(idx,jdx) num_threads(nthreads)
				do jdx=1,norblist
					do idx=1,norblist
						Omo(idir,idx,jdx)=Omo_slice(idx,jdx)
					end do
				end do
				!$OMP end parallel do
			end do
			deallocate(Dtmp,AOMtmp,Omo_slice)
			!Origin-center diagonal dipole integrals (leaves Qii-Qjj and off-diagonal Qij unchanged)
			do idir=1,3
				ravg=0D0
				do idx=1,norblist
					ravg=ravg+Omo(idir,idx,idx)
				end do
				ravg=ravg/dble(norblist)
				do idx=1,norblist
					Omo(idir,idx,idx)=Omo(idir,idx,idx)-ravg
				end do
			end do
		end if

		neven=norblist+mod(norblist,2)
		nhalf=neven/2
		gam_tol=1D-10
		allocate(Umat(norblist,norblist),top_orb(nhalf),bot_orb(nhalf), &
		         pair_rot(nhalf),pair_c(nhalf),pair_s(nhalf), &
		         rot_i(nhalf),rot_j(nhalf),rot_c(nhalf),rot_s(nhalf))
		Umat=0D0
		do idx=1,norblist
			Umat(idx,idx)=1D0
		end do

		Pvalold=0D0
		do idx=1,norblist
			do imat=1,nmat
				Pvalold=Pvalold+Omo(imat,idx,idx)**iexp
			end do
		end do
		if (imethod==3) then
			write(*,"(' Initial P:',f16.8)") Pvalold
		else
			write(*,"(' Initial F:',f18.8)") Pvalold
		end if

		do icyc=1,maxcyc
			do ipair=1,nhalf
				top_orb(ipair)=ipair
				bot_orb(ipair)=neven-ipair+1
			end do

			!$OMP parallel default(none) &
			!$OMP shared(nmat,iexp,norblist,neven,nhalf,Omo,Umat,top_orb,bot_orb, &
			!$OMP        pair_rot,pair_c,pair_s,rot_i,rot_j,rot_c,rot_s,n_rot,gam_tol) &
			!$OMP private(iround,ipair,idx,jdx,imat,Aval,Bval,Qii,Qjj,Qij,gamma,cg,sg, &
			!$OMP         irot,irow,icol,tmp1,tmp2,itmp) num_threads(nthreads)
			do iround=1,neven-1
				!Phase 1: Evaluate all disjoint pairs in this round (stride-1 along imat=1..nmat)
				!$OMP do schedule(static)
				do ipair=1,nhalf
					pair_rot(ipair)=.false.
					idx=top_orb(ipair)
					jdx=bot_orb(ipair)
					if (idx>norblist.or.jdx>norblist) cycle

					Aval=0D0
					Bval=0D0
					if (iexp==2) then
						do imat=1,nmat
							Qii=Omo(imat,idx,idx)
							Qjj=Omo(imat,jdx,jdx)
							Qij=Omo(imat,idx,jdx)
							Aval=Aval+Qij*Qij-0.25D0*(Qii-Qjj)**2
							Bval=Bval+Qij*(Qii-Qjj)
						end do
					else
						do imat=1,nmat
							Qii=Omo(imat,idx,idx)
							Qjj=Omo(imat,jdx,jdx)
							Qij=Omo(imat,idx,jdx)
							Aval=Aval-Qii**4-Qjj**4+6D0*(Qii*Qii+Qjj*Qjj)*Qij*Qij+Qii**3*Qjj+Qjj**3*Qii
							Bval=Bval+4D0*Qij*(Qii**3-Qjj**3)
						end do
					end if

					if (Aval*Aval+Bval*Bval<1D-14) cycle
					gamma=0.25D0*atan2(Bval,-Aval)
					if (abs(gamma)<gam_tol) cycle

					pair_rot(ipair)=.true.
					pair_c(ipair)=cos(gamma)
					pair_s(ipair)=sin(gamma)
				end do
				!$OMP end do

				!$OMP single
				n_rot=0
				do ipair=1,nhalf
					if (pair_rot(ipair)) then
						n_rot=n_rot+1
						rot_i(n_rot)=top_orb(ipair)
						rot_j(n_rot)=bot_orb(ipair)
						rot_c(n_rot)=pair_c(ipair)
						rot_s(n_rot)=pair_s(ipair)
					end if
				end do
				!$OMP end single

				if (n_rot>0) then
					!Phase 2: Right-multiply O <- O*G and U <- U*G on disjoint columns
					!$OMP do schedule(static)
					do irot=1,n_rot
						idx=rot_i(irot)
						jdx=rot_j(irot)
						cg=rot_c(irot)
						sg=rot_s(irot)
						do irow=1,norblist
							do imat=1,nmat
								tmp1=Omo(imat,irow,idx)
								tmp2=Omo(imat,irow,jdx)
								Omo(imat,irow,idx)=cg*tmp1+sg*tmp2
								Omo(imat,irow,jdx)=-sg*tmp1+cg*tmp2
							end do
						end do
						do irow=1,norblist
							tmp1=Umat(irow,idx)
							tmp2=Umat(irow,jdx)
							Umat(irow,idx)=cg*tmp1+sg*tmp2
							Umat(irow,jdx)=-sg*tmp1+cg*tmp2
						end do
					end do
					!$OMP end do

					!Phase 3: Left-multiply O <- G^T*O on disjoint columns icol (stride-1 along imat)
					!$OMP do schedule(static)
					do icol=1,norblist
						do irot=1,n_rot
							idx=rot_i(irot)
							jdx=rot_j(irot)
							cg=rot_c(irot)
							sg=rot_s(irot)
							do imat=1,nmat
								tmp1=Omo(imat,idx,icol)
								tmp2=Omo(imat,jdx,icol)
								Omo(imat,idx,icol)=cg*tmp1+sg*tmp2
								Omo(imat,jdx,icol)=-sg*tmp1+cg*tmp2
							end do
						end do
					end do
					!$OMP end do
				end if

				!$OMP single
				if (nhalf>1) then !Round-robin cyclic shift (keep top_orb(1) fixed)
					itmp=bot_orb(1)
					do ipair=1,nhalf-1
						bot_orb(ipair)=bot_orb(ipair+1)
					end do
					bot_orb(nhalf)=top_orb(nhalf)
					do ipair=nhalf,3,-1
						top_orb(ipair)=top_orb(ipair-1)
					end do
					top_orb(2)=itmp
				end if
				!$OMP end single
			end do
			!$OMP end parallel

			Pval=0D0
			do idx=1,norblist
				do imat=1,nmat
					Pval=Pval+Omo(imat,idx,idx)**iexp
				end do
			end do
			deltaPval=Pval-Pvalold
			if (imethod==3) then
				write(*,"(' Cycle:',i5,'  P:',f16.8,'  Delta P:',f16.8)") icyc,Pval,deltaPval
			else
				write(*,"(' Cycle:',i5,'  F:',f18.8,'  Delta F:',f18.8)") icyc,Pval,deltaPval
			end if
			if (abs(deltaPval)<crit) exit
			Pvalold=Pval
		end do

		allocate(Ctmp(nbasis,norblist))
		call dgemm('N','N',nbasis,norblist,norblist,1D0,Cact,nbasis,Umat,norblist,0D0,Ctmp,nbasis)
		do idx=1,norblist
			Cmat(:,orblist(idx))=Ctmp(:,idx)
		end do
		deallocate(Cact,Ctmp,Omo,Umat,top_orb,bot_orb,pair_rot,pair_c,pair_s,rot_i,rot_j,rot_c,rot_s)
	else if (imethod>=21.and.imethod<=24) then
		if (norblist<=0) cycle
		if (islmo_pop==1) then
			nmat_Q=natm_act
		else
			nmat_Q=ncenter
		end if
		if (nmat_Q<=0) cycle
		allocate(Cact(nbasis,norblist),Qmo(nmat_Q,norblist,norblist),Fmat_mo(norblist,norblist),Umat(norblist,norblist))
		do idx=1,norblist
			Cact(:,idx)=Cmat(:,orblist(idx))
		end do
		if (islmo_pop==1) then
			call slmo_build_Qmo_lowdin(nbasis,norblist,natm_act,atm_start,atm_end,Cact,Xmat,Qmo,nthreads)
		else
			write(*,*) "Transforming Becke atomic overlap matrices to MO basis, please wait..."
			call slmo_build_Qmo_becke(nbasis,norblist,ncenter,Cact,AOMbas,Qmo,nthreads)
		end if
		has_Fmat=.false.
		if (itime<=2.and.allocated(FmatA)) has_Fmat=.true.
		if (itime>=3.and.allocated(FmatB)) has_Fmat=.true.
		if (has_Fmat) then
			if (itime<=2) then
				call slmo_build_Fmo_ao(nbasis,norblist,Cact,FmatA,Fmat_mo)
			else
				call slmo_build_Fmo_ao(nbasis,norblist,Cact,FmatB,Fmat_mo)
			end if
			fock_ok=.true.
		else
			if (itime<=2) then
				call slmo_build_Fmo_ene(nbasis,norblist,orblist(1:norblist),MOene(1:nbasis),Fmat_mo,fock_ok)
			else
				call slmo_build_Fmo_ene(nbasis,norblist,orblist(1:norblist),MOene(nbasis+1:2*nbasis),Fmat_mo,fock_ok)
			end if
		end if
		call slmo_driver(imethod,nmat_Q,norblist,Qmo,Fmat_mo,fock_ok,orblist(1:norblist),atm_id(1:nmat_Q), &
			islmo_Htype,islmo_clust,islmo_m,slmo_w0,slmo_lamsep,slmo_eps0,slmo_lamH,slmo_tau,slmo_Bcut, &
			maxcyc,crit,Umat,icyc,nthreads)
		allocate(Ctmp(nbasis,norblist))
		call dgemm('N','N',nbasis,norblist,norblist,1D0,Cact,nbasis,Umat,norblist,0D0,Ctmp,nbasis)
		do idx=1,norblist
			Cmat(:,orblist(idx))=Ctmp(:,idx)
		end do
		deallocate(Cact,Ctmp,Qmo,Fmat_mo,Umat)
	end if
    
	if (icyc==maxcyc+1) then
		write(*,*) "Warning: Convergence failed!"
	else
		write(*,"(a)") " Successfully converged!"
	end if
end do
if (allocated(atm_start)) deallocate(atm_start,atm_end)
if (allocated(atm_id)) deallocate(atm_id)
if (allocated(AOMbas)) deallocate(AOMbas)

if (imethod==2) then !PM with Lowdin. Back convert CObas from orthonormal basis to original basis
    CObasa=matmul_blas(Xmatinv,CObasa,nbasis,nbasis,0,0)
	if (allocated(CObasb)) CObasb=matmul_blas(Xmatinv,CObasb,nbasis,nbasis,0,0)
	Sbas=Sbas_org
end if
if (allocated(Xmat)) deallocate(Xmat,Xmatinv)

call walltime(iwalltime2)
write(*,"(/,' Orbital localization took up wall clock time',i10,' s')") iwalltime2-iwalltime1


!Print orbital energies, sort orbitals according to energies
if (idoene==1) then
	write(*,*) "Evaluating orbital energies..."
	nmobeg=1
	if (isel/=3.and.idocore==0) nmobeg=ninnerele/2+1
	!Do Alpha part or closed-shell orbitals
	allocate(FLMOA(nbasis,nbasis),tmpmat(nbasis,nbasis))
    tmpmat=matmul_blas(CObasa,FmatA,nbasis,nbasis,1,0)
    FLMOA=matmul_blas(tmpmat,CObasa,nbasis,nbasis,0,0)
	!FLMOA=matmul(matmul(transpose(CObasa),FmatA),CObasa)
	if (isel==1) then
        nmoend=naelec
	else if (isel==2.or.isel==3) then
        nmoend=nbasis
    end if
	do iorb=nmobeg,nmoend
		MOene(iorb)=FLMOA(iorb,iorb)
	end do
	do iorb=nmobeg,nmoend
		do jorb=iorb+1,nmoend
			if (MOene(iorb)>MOene(jorb)) then	
				tmpbasarr=CObasa(:,iorb)
				CObasa(:,iorb)=CObasa(:,jorb)
				CObasa(:,jorb)=tmpbasarr
				tmpprimarr=CO(iorb,:)
				CO(iorb,:)=CO(jorb,:)
				CO(jorb,:)=tmpprimarr
				tmpene=MOene(iorb)
				MOene(iorb)=MOene(jorb)
				MOene(jorb)=tmpene
			end if
		end do
	end do
    write(*,*)
	write(*,*) "Energies of localized orbitals:"
	do iorb=nmobeg,nmoend
        if (orblist_did(iorb)==0) cycle
		typestr="A+B"
		if (wfntype==1)	typestr="A"
		write(*,"(i6,'   Energy:',f13.7,' a.u.',f13.4,' eV   Type: ',a,'  Occ:',f4.1)") &
		iorb,MOene(iorb),MOene(iorb)*au2eV,typestr,MOocc(iorb)
	end do
	!Do beta part
	if (wfntype==1) then
		allocate(FLMOB(nbasis,nbasis))
		tmpmat=matmul_blas(CObasb,FmatB,nbasis,nbasis,1,0)
		FLMOB=matmul_blas(tmpmat,CObasb,nbasis,nbasis,0,0)
		!FLMOB=matmul(matmul(transpose(CObasb),FmatB),CObasb)
		if (isel==1) then
            nmoend=nbelec
		else if (isel==2.or.isel==3) then
            nmoend=nbasis
        end if
		do iorb=nmobeg,nmoend
			MOene(nbasis+iorb)=FLMOB(iorb,iorb)
		end do
		do iorb=nmobeg,nmoend
			do jorb=iorb+1,nmoend
				if (MOene(nbasis+iorb)>MOene(nbasis+jorb)) then	
					tmpbasarr=CObasb(:,iorb)
					CObasb(:,iorb)=CObasb(:,jorb)
					CObasb(:,jorb)=tmpbasarr
					tmpprimarr=CO(nbasis+iorb,:)
					CO(nbasis+iorb,:)=CO(nbasis+jorb,:)
					CO(nbasis+jorb,:)=tmpprimarr
					tmpene=MOene(nbasis+iorb)
					MOene(nbasis+iorb)=MOene(nbasis+jorb)
					MOene(nbasis+jorb)=tmpene
				end if
			end do
		end do
		typestr="B"
		do iorb=nmobeg,nmoend
            if (all(orblist(1:norblist)/=iorb)) cycle
			write(*,"(i6,'   Energy:',f13.7,' a.u.',f13.4,' eV   Type: ',a,'  Occ:',f4.1)") &
			iorb+nbasis,MOene(iorb+nbasis),MOene(iorb+nbasis)*au2eV,typestr,MOocc(iorb+nbasis)
		end do
	end if
	if (isel/=3.and.idocore==0)  write(*,*) "Energies of core orbitals are not updated since they were not localized"
	if (isel==1) write(*,*) "Energies of unoccupied orbitals are not updated since they were not localized"
	
	!Second-order perturbation analysis between occupied and virtual orbitals (like NBO E2), this only works when both of them have been localized
	!This part is commented since it don't print any useful result, because it is easy to proved that Fock element between occupied and virtual LMOs are exactly zero
! 	if (isel==1) then
! 		write(*,*) " Note: E(2) analysis is skipped since virtual orbitals were not localized"
! 	else if (isel==2) then
! 		write(*,*) "Second-order perturbation theory analysis of interaction energy:"
! 		!Regenerated Fock matrix in LMO, since they have been sorted
! 		FLMOA=matmul(matmul(transpose(CObasa),FmatA),CObasa)
! 		call showmatgau(FLMOA)
! 		read(*,*)
! 		coeff=2
! 		do iocc=1,naelec
! 			do ivir=naelec+1,nbasis
! 				E2val=-coeff* FLMOA(iocc,ivir)**2/(MOene(ivir)-MOene(iocc))
! 				qCT=coeff* ( FLMOA(iocc,ivir)/(MOene(ivir)-MOene(iocc)) )**2
! 				if (abs(E2val*au2kcal)>0.2D0) then
! 					write(*,"(' Donor:',i5,'  -  Acceptor:',i5,'   E(2):',f7.2,' kcal/mol   q_CT:',f10.5)") iocc,ivir,E2val*au2kcal,qCT
! 					write(*,"(3f16.10)") FLMOA(iocc,ivir),MOene(ivir)-MOene(iocc)
! 				end if
! 			end do
! 		end do
! 	end if
end if


!Calculate orbital composition and print major character of LMOs
if (icompmethod>0) then
	orbtype=0
	!At most four batches, 1: Alpha-occ 2: Alpha-vir 3: Beta-occ 4: Beta-vir
	do itime=1,4
        if (domark(itime)==0) cycle
        if (isel==1.or.isel==2) then
		    if (itime<=2) then !For batches 1 and 2, use alpha density matrix
			    Cmat=>CObasa
		    else !For batches 3 and 4, use beta density matrix
			    Cmat=>CObasb
		    end if
		    if (itime==1) then
			    ibeg=1
			    if (idocore==0) ibeg=ninnerele/2+1
			    iend=naelec
		    else if (itime==2) then
			    ibeg=naelec+1
			    iend=nbasis
		    else if (itime==3) then
			    ibeg=1
			    if (idocore==0) ibeg=ninnerele/2+1
			    iend=nbelec
		    else if (itime==4) then
			    ibeg=nbelec+1
			    iend=nbasis
		    end if
            norblist=iend-ibeg+1
            forall(i=1:norblist) orblist(i)=ibeg-1+i
        else if (isel==3) then
            !orblist has already been set, however ibeg and iend should be set since will be used later
            ibeg=minval(orblist(1:norblist))
            iend=maxval(orblist(1:norblist))
        end if
		
		!Calculate orbital composition and then sort from large to small. Size: orbcomp(1:ncenter,1:nbasis)
        write(*,*) "Calculating orbital compositions..."
        if (icompmethod==1) then !Mulliken+SCPA
			orbcomp=0
		    do idx=1,norblist
                iorb=orblist(idx)
			    if (itime==1.or.itime==3) then !For occupied LMOs, use Mulliken
				    do ibas=1,nbasis
					    bascross=0D0
					    do jbas=1,nbasis
						    if (jbas==ibas) cycle
						    bascross=bascross+Cmat(ibas,iorb)*Cmat(jbas,iorb)*Sbas(ibas,jbas)
					    end do
					    bastot(ibas)=Cmat(ibas,iorb)**2+bascross
				    end do
				    do iatm=1,ncenter
						if (basstart(iatm)==0) cycle
					    orbcomp(iatm,iorb)=sum(bastot(basstart(iatm):basend(iatm)))
				    end do
			    else !For virtual LMOs, use SCPA. Since it guarantees that the result is within 0~100%
 				    do iatm=1,ncenter
						if (basstart(iatm)==0) cycle
 					    orbcomp(iatm,iorb)=sum(Cmat(basstart(iatm):basend(iatm),iorb)**2)
 				    end do
 				    orbcomp(:,iorb)=orbcomp(:,iorb)/sum(orbcomp(:,iorb))
			    end if
            end do
        else if (icompmethod==2.or.icompmethod==3) then
            write(*,*)
            if (icompmethod==2) itmp=1 !Hirshfeld
            if (icompmethod==3) itmp=2 !Becke
            allocate(CO_tmp(nmo,nprims))
            CO_tmp=CO
            if (itime==1.or.itime==2) then !Alpha
                call CObas2CO(1) !Convert current CObasa to CO, which is needed by Hirshfeld/Becke method
                call gen_orbatmcomp_space(itmp,orbcomp(:,ibeg:iend),ibeg,iend,0,0)
            else if (itime==3.or.itime==4) then !Beta
                call CObas2CO(2) !Convert current CObasb to CO, which is needed by Hirshfeld/Becke method
                call gen_orbatmcomp_space(itmp,orbcomp(:,ibeg:iend),ibeg+nbasis,iend+nbasis,0,0) !Use cheap grid
            end if
            CO=CO_tmp
            deallocate(CO_tmp)
        end if
        
        !Sort atomic contributions
		do idx=1,norblist
            iorb=orblist(idx)
			forall(iatm=1:ncenter) iatmarr(iatm,iorb)=iatm
			call sort(orbcomp(:,iorb),"val",iatmarr(:,iorb)) !Sort atomic contributions from small to large
			call invarr(orbcomp(:,iorb),iatmarr(:,iorb)) !Then become from large to small
		end do
		
        if (itime==1) write(*,"(/,a)") " Hint: If you hope to print the LMOs in the order of atoms and atomic pairs, &
        &set ""iprintLMOorder"" in settings.ini to 1 prior to the analysis"
		if (wfntype==0) then
			if (itime==1) write(*,"(/,a)") " **** Major character of occupied LMOs:"
			if (itime==2) write(*,"(/,a)") " **** Major character of unoccupied LMOs:"
		else if (wfntype==1) then
			if (itime==1) write(*,"(/,a)") " **** Major character of alpha occupied LMOs:"
			if (itime==2) write(*,"(/,a)") " **** Major character of alpha unoccupied LMOs:"
			if (itime==3) write(*,"(/,a)") " **** Major character of beta occupied LMOs:"
			if (itime==4) write(*,"(/,a)") " **** Major character of beta unoccupied LMOs:"
		end if
		istatarr=0 !If =1, then the character of the LMO has been identified and printed
		write(*,"(' Almost single center LMOs: (An atom has contribution >',f5.1,'%)')") crit1c*100
		itmp=0
        if (iprintLMOorder==0) then !Print LMO in original order
		    do idx=1,norblist
                iorb=orblist(idx)
			    if (orbcomp(1,iorb)>crit1c) then
				    write(*,"(i5,':',i4,'(',a,')',f5.1,'%    ')",advance='no') iorb,iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100
				    itmp=itmp+1
				    if (mod(itmp,3)==0) write(*,*)
				    istatarr(iorb)=1
				    if (itime<=2) then
					    orbtype(iorb)=1
					    orbatm(1,iorb)=iatmarr(1,iorb)
				    else
					    orbtype(iorb+nbasis)=1
					    orbatm(1,iorb+nbasis)=iatmarr(1,iorb)
				    end if
			    end if
		    end do
        else if (iprintLMOorder==1) then !Print LMO in the sequence of major contribution atom
            do iatm=1,ncenter
		        do idx=1,norblist
                    iorb=orblist(idx)
			        if (orbcomp(1,iorb)>crit1c.and.iatmarr(1,iorb)==iatm) then
				        write(*,"(i5,':',i4,'(',a,')',f5.1,'%    ')",advance='no') iorb,iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100
				        itmp=itmp+1
				        if (mod(itmp,3)==0) write(*,*)
				        istatarr(iorb)=1
				        if (itime<=2) then
					        orbtype(iorb)=1
					        orbatm(1,iorb)=iatmarr(1,iorb)
				        else
					        orbtype(iorb+nbasis)=1
					        orbatm(1,iorb+nbasis)=iatmarr(1,iorb)
				        end if
			        end if
		        end do
            end do
        end if
		if (mod(itmp,3)/=0) write(*,*)
		if (itmp==0) write(*,*) "None!"
		
		if (all(istatarr(orblist(1:norblist))==1)) cycle
		write(*,*)
		write(*,"(' Almost two-center LMOs: (Sum of two largest contributions >',f5.1,'%)')") crit2c*100
		itmp=0
        if (iprintLMOorder==0) then !Print LMO in original order
		    do idx=1,norblist
                iorb=orblist(idx)
			    if (istatarr(iorb)==1) cycle
			    if (orbcomp(1,iorb)+orbcomp(2,iorb)>crit2c) then
				    write(*,"(i5,':',i4,'(',a,')',f5.1,'%',i4,'(',a,')',f5.1,'%     ')",advance='no') &
				    iorb,iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100,&
				    iatmarr(2,iorb),a(iatmarr(2,iorb))%name,orbcomp(2,iorb)*100
				    itmp=itmp+1
				    if (mod(itmp,2)==0) write(*,*)
				    istatarr(iorb)=1
				    if (itime<=2) then
					    orbtype(iorb)=2
					    orbatm(:,iorb)=iatmarr(1:2,iorb)
				    else
					    orbtype(iorb+nbasis)=2
					    orbatm(:,iorb+nbasis)=iatmarr(1:2,iorb)
				    end if
			    end if
		    end do
        else if (iprintLMOorder==1) then !Print LMO in the sequence of major contribution atomic pair
            do iatm=1,ncenter
                do jatm=iatm+1,ncenter
		            do idx=1,norblist
                        iorb=orblist(idx)
			            if (istatarr(iorb)==1) cycle
			            if (orbcomp(1,iorb)+orbcomp(2,iorb)>crit2c) then
                            if (iatmarr(1,iorb)==iatm.and.iatmarr(2,iorb)==jatm) then
				                write(*,"(i5,':',i4,'(',a,')',f5.1,'%',i4,'(',a,')',f5.1,'%     ')",advance='no') &
				                iorb,iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100,&
				                iatmarr(2,iorb),a(iatmarr(2,iorb))%name,orbcomp(2,iorb)*100
                            else if (iatmarr(1,iorb)==jatm.and.iatmarr(2,iorb)==iatm) then
				                write(*,"(i5,':',i4,'(',a,')',f5.1,'%',i4,'(',a,')',f5.1,'%     ')",advance='no') &
				                iorb,iatmarr(2,iorb),a(iatmarr(2,iorb))%name,orbcomp(2,iorb)*100,&
				                iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100
                            else
                                cycle
                            end if
				            itmp=itmp+1
				            if (mod(itmp,2)==0) write(*,*)
				            istatarr(iorb)=1
				            if (itime<=2) then
					            orbtype(iorb)=2
					            orbatm(:,iorb)=iatmarr(1:2,iorb)
				            else
					            orbtype(iorb+nbasis)=2
					            orbatm(:,iorb+nbasis)=iatmarr(1:2,iorb)
				            end if
			            end if
		            end do
                end do
            end do
        end if
		if (mod(itmp,2)/=0) write(*,*)
		if (itmp==0) write(*,*) "None!"
		
		if (all(istatarr(orblist(1:norblist))==1)) cycle
		write(*,*)
		write(*,*) "More delocalized LMOs: (Three largest contributions are printed)"
		do idx=1,norblist
            iorb=orblist(idx)
			if (istatarr(iorb)==1) cycle
			write(*,"(i5,':',i5,'(',a,')',f5.1,'%',i5,'(',a,')',f5.1,'%',i5,'(',a,')',f5.1,'%')") &
			iorb,iatmarr(1,iorb),a(iatmarr(1,iorb))%name,orbcomp(1,iorb)*100,&
			iatmarr(2,iorb),a(iatmarr(2,iorb))%name,orbcomp(2,iorb)*100,&
			iatmarr(3,iorb),a(iatmarr(3,iorb))%name,orbcomp(3,iorb)*100
		end do
	end do
end if

write(*,*)
write(*,*) "Exporting localized orbitals to new.fch in current folder..."
call outfch("new.fch",10,1)

if (ireload==1) then !Automatically reload the newly generated new.fch as requested
	call dealloall(0)
	write(*,*) "Loading new.fch..."
    call readinfile("new.fch",1)
	write(*,*) "Loading finished!"

	!Adding center of LMOs as Bq atoms
	if (ilmocen==1) then
        if (isel==3) then
            write(*,*) "Note: Calculating center of LMOs is not supported in current case"
            return
        end if
        write(*,*) "Generating electric dipole moment integral matrix..."
        call genDbas_curr
		write(*,*)
		write(*,*) "Calculating center of LMOs and meanwhile adding them as Bq atoms..."
		
		!Backup a to a_tmp, then add Bq to a_tmp during calculation, and finally copy a_tmp to a
		if (isel==1) then
			ncenter_new=ncenter+nint(naelec)
			if (wfntype==1) ncenter_new=ncenter_new+nint(nbelec)
		else if (isel==2) then
			ncenter_new=ncenter+nbasis
			if (wfntype==1) ncenter_new=ncenter_new+nbasis
		end if
		if (idocore==0) then
			if (wfntype==0) ncenter_new=ncenter_new-ninnerele/2
			if (wfntype==1) ncenter_new=ncenter_new-ninnerele
		end if
		if (allocated(a_tmp)) deallocate(a_tmp)
		allocate(a_tmp(ncenter_new))
		a_tmp(1:ncenter)=a
		itmp=ncenter
		
		LMOpos=0
		open(10,file="LMOcen.txt",status="replace")
		if (wfntype==0) ntime=1
		if (wfntype==1) ntime=2
		do itime=1,ntime !=1: Total or alpha, =2: Beta
			if (itime==1) then
				ibeg=1
				if (idocore==0) ibeg=ninnerele/2+1
				iend=nint(naelec)
				if (isel==2) iend=nbasis
			else if (itime==2) then
				ibeg=nbasis+1
				if (idocore==0) ibeg=nbasis+ninnerele/2+1
				iend=nbasis+nint(nbelec)
				if (isel==2) iend=2*nbasis
			end if
			do iorb=ibeg,iend
				!The Dbas contains negative sign of operator r, therefore we need to use "minus"
				if (itime==1) then
					do ibas=1,nbasis
						do jbas=1,nbasis
							LMOpos(:,iorb)=LMOpos(:,iorb)-Dbas(:,ibas,jbas)*CObasa(ibas,iorb)*CObasa(jbas,iorb)
						end do
					end do
				else
					do ibas=1,nbasis
						do jbas=1,nbasis
							LMOpos(:,iorb)=LMOpos(:,iorb)-Dbas(:,ibas,jbas)*CObasb(ibas,iorb-nbasis)*CObasb(jbas,iorb-nbasis)
						end do
					end do
				end if
				itmp=itmp+1
				a_tmp(itmp)%x=LMOpos(1,iorb)
				a_tmp(itmp)%y=LMOpos(2,iorb)
				a_tmp(itmp)%z=LMOpos(3,iorb)
				a_tmp(itmp)%index=0
				a_tmp(itmp)%charge=0
				a_tmp(itmp)%name="Bq"
				if (itime==1) then
					if (wfntype==0) write(10,"(' LMO',i6,' corresponds to Bq',i6,', X,Y,Z:',3f10.4,' Bohr')") iorb,itmp,LMOpos(:,iorb)
					if (wfntype==1) write(10,"(' Alpha LMO',i6,': Bq',i6,', X,Y,Z:',3f10.4,' Bohr')") iorb,itmp,LMOpos(:,iorb)
				else
					write(10,"(' Beta LMO ',i6,': Bq',i6,', X,Y,Z:',3f10.4,' Bohr')") iorb-nbasis,itmp,LMOpos(:,iorb)
				end if
			end do
		end do
		close(10)
		
		ncenter=ncenter_new
		deallocate(a)
		allocate(a(ncenter))
		a=a_tmp
		deallocate(a_tmp)
		!Set plotting parameters in main function 0 to the best status for showing LMO centers
		iatmlabtype3D=4
		ishowaxis=0
		bondradius=0.06D0
		ratioatmsphere=0.6D0
		iatmlabtype3D=5
		isosur1style=2
		isosur2style=2
		atmlabclrR=1D0;atmlabclrG=0D0;atmlabclrB=0D0
		write(*,"(/,a)") " Done! The Bq atoms in current system now correspond to center of LMOs. The LMO center coordinates, &
		&correspondence between LMO indices and Bq indices have been exported to LMOcen.txt in current folder. In addition, &
		&the plotting parameters in main function 0 have been set to the best status for showing LMO centers"
		write(*,"(a)") " Note: Since these Bq atoms do not have corresponding basis functions, &
		&the present wavefunction should not be subjected to wavefunction analyses, otherwise Multiwfn may crash"
		write(*,*)
		
		
		!---- Calculate dipole moment LMOs
		!LMOpos is <phi|r|phi>, therefore its negative is LMO electronic contribution to dipole moment
		write(*,*) "Would you like to perform dipole moment analysis for occupied LMOs? (y/n)"
		read(*,*) selectyn
		if (selectyn=='y'.or.selectyn=='Y') then
			!Evaluate system total dipole moment
			x_nuc=sum(a%charge*a%x);y_nuc=sum(a%charge*a%y);z_nuc=sum(a%charge*a%z)
			x_ele=0;y_ele=0;z_ele=0
			if (wfntype==0) then
				occval=2D0
				do iLMO=1,nint(naelec)
					x_ele=x_ele-LMOpos(1,iLMO);y_ele=y_ele-LMOpos(2,iLMO);z_ele=z_ele-LMOpos(3,iLMO)
				end do
				x_ele=x_ele*occval;y_ele=y_ele*occval;z_ele=z_ele*occval
			else if (wfntype==1) then
				occval=1D0
				do iLMO=1,nint(naelec)
					x_ele=x_ele-LMOpos(1,iLMO);y_ele=y_ele-LMOpos(2,iLMO);z_ele=z_ele-LMOpos(3,iLMO)
				end do
				do iLMO=1,nint(nbelec)
					x_ele=x_ele-LMOpos(1,iLMO+nbasis);y_ele=y_ele-LMOpos(2,iLMO+nbasis);z_ele=z_ele-LMOpos(3,iLMO+nbasis)
				end do
			end if
			x_tot=x_nuc+x_ele;y_tot=y_nuc+y_ele;z_tot=z_nuc+z_ele
			
			open(10,file="LMOdip.txt",status="replace")
			write(10,"(' Dipole moment of the whole system (including nuclear and electronic contributions)',/,' X/Y/Z:',3f10.5,'  Norm:',f10.5,' a.u.')") &
			x_tot,y_tot,z_tot,dsqrt(x_tot**2+y_tot**2+z_tot**2)
			write(10,"(' Nuclear contribution:',/,' X/Y/Z:',3f10.5,'  Norm:',f10.5,' a.u.')") &
			x_nuc,y_nuc,z_nuc,dsqrt(x_nuc**2+y_nuc**2+z_nuc**2)
			write(10,"(' Electronic contribution:',/,' X/Y/Z:',3f10.5,'  Norm:',f10.5,' a.u.',/)") &
			x_ele,y_ele,z_ele,dsqrt(x_ele**2+y_ele**2+z_ele**2)
			!Total or alpha part
			if (wfntype==1) then
				write(10,*) "===================================="
				write(10,*) "============ Alpha LMOs ============"
				write(10,*) "===================================="
				write(10,*)
			end if
			write(10,*) "Single-center orbital dipole moments (a.u.):"
			tmpbx=0;tmpby=0;tmpbz=0
			do iLMO=1,nint(naelec)
				if (orbtype(iLMO)==1) then
					iatm=orbatm(1,iLMO)
					xdip=(a(iatm)%x-LMOpos(1,iLMO)) *occval
					ydip=(a(iatm)%y-LMOpos(2,iLMO)) *occval
					zdip=(a(iatm)%z-LMOpos(3,iLMO)) *occval
					write(10,"(i5,' (',i4,a,')  X/Y/Z:',3f10.5,'  Norm:',f10.5)") &
					iLMO,iatm,a(iatm)%name,xdip,ydip,zdip,dsqrt(xdip**2+ydip**2+zdip**2)
					tmpbx=tmpbx+xdip;tmpby=tmpby+ydip;tmpbz=tmpbz+zdip
				end if
			end do
			write(10,"(' Sum            X/Y/Z:',3f10.5,'  Norm:',f10.5)") tmpbx,tmpby,tmpbz,dsqrt(tmpbx**2+tmpby**2+tmpbz**2)
			write(10,*)
			!If you want to visualize the positive charge center, uncomment below lines
			!allocate(a_tmp(ncenter+count(orbtype==2)))
			!a_tmp(1:ncenter)=a
			write(10,*) "Two-center bond dipole moments (a.u.):"
			tmpbx=0;tmpby=0;tmpbz=0
			do iLMO=1,nint(naelec)
				if (orbtype(iLMO)==2) then
					iatm=orbatm(1,iLMO)
					jatm=orbatm(2,iLMO)
					ratioi=covr(a(iatm)%index) !Adjust positive charge center according to covalent radii
					ratioj=covr(a(jatm)%index)
					!ratioi=0.5D0 !Use bond midpoint as positive charge center, as the "dipole" keyword of NBO used
					!ratioj=0.5D0
					tmpsum=ratioi+ratioj
					ratioi=ratioi/tmpsum
					ratioj=ratioj/tmpsum
					posx=a(iatm)%x*ratioj+a(jatm)%x*ratioi
					posy=a(iatm)%y*ratioj+a(jatm)%y*ratioi
					posz=a(iatm)%z*ratioj+a(jatm)%z*ratioi
					xdip=occval*posx-occval*LMOpos(1,iLMO)
					ydip=occval*posy-occval*LMOpos(2,iLMO)
					zdip=occval*posz-occval*LMOpos(3,iLMO)
					!ncenter=ncenter+1
					!a_tmp(ncenter)%x=posx;a_tmp(ncenter)%y=posy;a_tmp(ncenter)%z=posz
					!a_tmp(ncenter)%index=0;a_tmp(ncenter)%name="Bq";a_tmp(ncenter)%charge=0
					!write(*,"(3i5,2f6.3,3f10.4)") ncenter,iatm,jatm,ratioi,ratioj,posx,posy,posz
					!write(*,"(3f10.4)") -LMOpos(:,iLMO)
					write(10,"(i5,' (',i4,a,' -',i4,a,')  X/Y/Z:',3f10.5,'  Norm:',f10.5)") &
					iLMO,iatm,a(iatm)%name,jatm,a(jatm)%name,xdip,ydip,zdip,dsqrt(xdip**2+ydip**2+zdip**2)
					tmpbx=tmpbx+xdip;tmpby=tmpby+ydip;tmpbz=tmpbz+zdip
				end if
			end do
			write(10,"(' Sum                    X/Y/Z:',3f10.5,'  Norm:',f10.5)") tmpbx,tmpby,tmpbz,dsqrt(tmpbx**2+tmpby**2+tmpbz**2)
			!deallocate(a)
			!allocate(a(ncenter))
			!a=a_tmp
			!deallocate(a_tmp)
			if (any(orbtype(1:nint(naelec))==0)) then
				write(10,"(/,a)") " Some more delocalized LMOs exist, but ignored here" 
			end if
			write(10,*)
			write(10,*) "Contributions of all occupied LMOs to system dipole moment (a.u.):"
			do iLMO=1,nint(naelec)
				write(10,"(i5,'  X/Y/Z:',3f10.5,'  Norm:',f10.5)") iLMO,-LMOpos(:,iLMO)*occval,dsqrt(sum(LMOpos(:,iLMO)**2))*occval
			end do
			x_LMOs=sum(-LMOpos(1,1:nint(naelec)))*occval
			y_LMOs=sum(-LMOpos(2,1:nint(naelec)))*occval
			z_LMOs=sum(-LMOpos(3,1:nint(naelec)))*occval
			write(10,"(' Sum   X/Y/Z:',3f10.5,'  Norm:',f10.5)") x_LMOs,y_LMOs,z_LMOs,dsqrt(x_LMOs**2+y_LMOs**2+z_LMOs**2)
			
			!Beta part, simply repeat above codes
			if (wfntype==1) then
				write(10,*)
				write(10,*) "===================================="
				write(10,*) "============ Beta LMOs ============="
				write(10,*) "===================================="
				write(10,*)
				write(10,*) "Single-center orbital dipole moments (a.u.):"
				tmpbx=0;tmpby=0;tmpbz=0
				do iLMO=1,nint(nbelec)
					if (orbtype(iLMO+nbasis)==1) then
						iatm=orbatm(1,iLMO+nbasis)
						xdip=(a(iatm)%x-LMOpos(1,iLMO+nbasis)) *occval
						ydip=(a(iatm)%y-LMOpos(2,iLMO+nbasis)) *occval
						zdip=(a(iatm)%z-LMOpos(3,iLMO+nbasis)) *occval
						write(10,"(i5,' (',i4,a,')  X/Y/Z:',3f10.5,'  Norm:',f10.5)") &
						iLMO,iatm,a(iatm)%name,xdip,ydip,zdip,dsqrt(xdip**2+ydip**2+zdip**2)
						tmpbx=tmpbx+xdip;tmpby=tmpby+ydip;tmpbz=tmpbz+zdip
					end if
				end do
				write(10,"(' Sum            X/Y/Z:',3f10.5,'  Norm:',f10.5)") tmpbx,tmpby,tmpbz,dsqrt(tmpbx**2+tmpby**2+tmpbz**2)
				write(10,*)
				write(10,*) "Two-center bond dipole	moments (a.u.):"
				tmpbx=0;tmpby=0;tmpbz=0
				do iLMO=1,nint(nbelec)
					if (orbtype(iLMO+nbasis)==2) then
						iatm=orbatm(1,iLMO+nbasis)
						jatm=orbatm(2,iLMO+nbasis)
						ratioi=covr(a(iatm)%index) !Adjust positive charge center according to covalent radii
						ratioj=covr(a(jatm)%index)
						!ratioi=0.5D0 !Use bond midpoint as positive charge center, this is the "dipole" keyword of NBO used
						!ratioj=0.5D0
						tmpsum=ratioi+ratioj;ratioi=ratioi/tmpsum;ratioj=ratioj/tmpsum
						posx=a(iatm)%x*ratioj+a(jatm)%x*ratioi
						posy=a(iatm)%y*ratioj+a(jatm)%y*ratioi
						posz=a(iatm)%z*ratioj+a(jatm)%z*ratioi
						xdip=occval*posx-occval*LMOpos(1,iLMO+nbasis)
						ydip=occval*posy-occval*LMOpos(2,iLMO+nbasis)
						zdip=occval*posz-occval*LMOpos(3,iLMO+nbasis)
						write(10,"(i5,' (',i4,a,' -',i4,a,')  X/Y/Z:',3f10.5,'  Norm:',f10.5)") &
						iLMO,iatm,a(iatm)%name,jatm,a(jatm)%name,xdip,ydip,zdip,dsqrt(xdip**2+ydip**2+zdip**2)
						tmpbx=tmpbx+xdip;tmpby=tmpby+ydip;tmpbz=tmpbz+zdip
					end if
				end do
				write(10,"(' Sum                    X/Y/Z:',3f10.5,'  Norm:',f10.5)") tmpbx,tmpby,tmpbz,dsqrt(tmpbx**2+tmpby**2+tmpbz**2)
				if (any(orbtype(1:nint(naelec))==0)) then
					write(10,"(/,a)") " Some more delocalized LMOs exist, but ignored here" 
				end if
				write(10,*)
				write(10,*) "Contributions of all occupied LMOs to system dipole moment (a.u.):"
				do iLMO=1,nint(nbelec)
					write(10,"(i5,'  X/Y/Z:',3f10.5,'  Norm:',f10.5)") iLMO,&
					-LMOpos(:,iLMO+nbasis)*occval,dsqrt(sum(LMOpos(:,iLMO+nbasis)**2))*occval
				end do
				x_LMOs=sum(-LMOpos(1,1:nint(nbelec)))*occval
				y_LMOs=sum(-LMOpos(2,1:nint(nbelec)))*occval
				z_LMOs=sum(-LMOpos(3,1:nint(nbelec)))*occval
				write(10,"(' Sum   X/Y/Z:',3f10.5,'  Norm:',f10.5)") x_LMOs,y_LMOs,z_LMOs,dsqrt(x_LMOs**2+y_LMOs**2+z_LMOs**2)
			end if
			
			close(10)
			write(*,"(a)") " Done! Dipole moment of occupied LMOs as well as their contribution to &
			&system dipole moment have been exported as LMOdip.txt in current folder"
		end if
	end if
end if
end subroutine



!------ Calculate Q value used for determining localization convergence
real*8 function Qval(Cmat,imo,jmo,iatm)
use defvar
real*8 Cmat(nbasis,nbasis)
integer imo,jmo,iatm,ibas
Qval=0
do ibas=basstart(iatm),basend(iatm)
	Qval=Qval+sum( (Cmat(:,imo)*Cmat(ibas,jmo)+Cmat(ibas,imo)*Cmat(:,jmo)) *Sbas(:,ibas) )
end do
Qval=Qval/2D0
end function


!------ Calculate dipole moment integral between orbitals that involved in Boys localization
subroutine boysdipint(iri,jrj,irj,imo,jmo,Cmat)
use defvar
implicit real*8 (a-h,o-z)
integer imo,jmo
real*8 :: iri(3),jrj(3),irj(3),iripriv(3),jrjpriv(3),irjpriv(3),Cmat(nbasis,nbasis)
iri=0
jrj=0
irj=0
!$OMP parallel shared(iri,jrj,irj) private(iripriv,jrjpriv,irjpriv) num_threads(nthreads)
iripriv=0
jrjpriv=0
irjpriv=0
!$OMP do schedule(DYNAMIC)
do ibas=1,nbasis
	do jbas=1,nbasis
		iripriv=iripriv+Dbas(:,ibas,jbas)*Cmat(ibas,imo)*Cmat(jbas,imo)
		jrjpriv=jrjpriv+Dbas(:,ibas,jbas)*Cmat(ibas,jmo)*Cmat(jbas,jmo)
		irjpriv=irjpriv+Dbas(:,ibas,jbas)*Cmat(ibas,imo)*Cmat(jbas,jmo)
	end do
end do
!$OMP END DO
!$OMP CRITICAL
iri=iri+iripriv
jrj=jrj+jrjpriv
irj=irj+irjpriv
!$OMP END CRITICAL
!$OMP END PARALLEL
end subroutine


!------ Compute atomic diagonal populations, P contribution, and 64-bit active-atom bitmask for one orbital
subroutine calc_orb_pm_info(imethod,iPMexp,nbasis,natm_act,atm_start,atm_end, &
	nwords,r_tol2,Cvec,SCvec,Qorb,Porb,mask_orb,iw_lo,iw_hi)
use, intrinsic :: iso_fortran_env, only: int64
implicit none
integer,intent(in) :: imethod,iPMexp,nbasis,natm_act,atm_start(natm_act),atm_end(natm_act),nwords
real*8,intent(in) :: r_tol2,Cvec(nbasis),SCvec(nbasis)
real*8,intent(out) :: Qorb(natm_act),Porb
integer(int64),intent(out) :: mask_orb(nwords)
integer,intent(out) :: iw_lo,iw_hi
integer :: ia,is,ie,ibas,iw,ibit
real*8 :: qii,c2sum,v2sum,r2val

mask_orb=0_int64
Porb=0D0
iw_lo=nwords+1
iw_hi=0

do ia=1,natm_act
	is=atm_start(ia)
	ie=atm_end(ia)
	if (imethod==1) then
		qii=0D0
		c2sum=0D0
		v2sum=0D0
		do ibas=is,ie
			qii=qii+Cvec(ibas)*SCvec(ibas)
			c2sum=c2sum+Cvec(ibas)*Cvec(ibas)
			v2sum=v2sum+SCvec(ibas)*SCvec(ibas)
		end do
		r2val=0.5D0*(c2sum+v2sum)
	else
		qii=0D0
		do ibas=is,ie
			qii=qii+Cvec(ibas)*Cvec(ibas)
		end do
		r2val=qii
	end if
	Qorb(ia)=qii
	Porb=Porb+qii**iPMexp
	if (r2val>r_tol2) then
		iw=ishft(ia-1,-6)+1
		ibit=iand(ia-1,63)
		mask_orb(iw)=ibset(mask_orb(iw),ibit)
		if (iw<iw_lo) iw_lo=iw
		if (iw>iw_hi) iw_hi=iw
	end if
end do
end subroutine


!==============================================================================
! Semi-localized molecular orbital (SLMO) helper subroutines (imethod=21..24)
!==============================================================================

!------ Build Lowdin atomic population matrices Q^A in active MO basis: Qmo(ia, i, j)
subroutine slmo_build_Qmo_lowdin(nbasis,norb,natm_act,atm_start,atm_end,Cact,Xmat,Qmo,nthreads)
implicit none
integer,intent(in) :: nbasis,norb,natm_act,atm_start(natm_act),atm_end(natm_act),nthreads
real*8,intent(in) :: Cact(nbasis,norb),Xmat(nbasis,nbasis)
real*8,intent(out) :: Qmo(natm_act,norb,norb)
integer :: ia,is,ie,nba,i,j
real*8 :: val
real*8,allocatable :: Clow(:,:),Qslice(:,:)

allocate(Clow(nbasis,norb),Qslice(norb,norb))
call dgemm('N','N',nbasis,norb,nbasis,1D0,Xmat,nbasis,Cact,nbasis,0D0,Clow,nbasis)
do ia=1,natm_act
	is=atm_start(ia)
	ie=atm_end(ia)
	nba=ie-is+1
	call dgemm('T','N',norb,norb,nba,1D0,Clow(is,1),nbasis,Clow(is,1),nbasis,0D0,Qslice,norb)
	!$OMP parallel do default(none) shared(Qmo,Qslice,ia,norb) private(i,j,val) num_threads(nthreads)
	do j=1,norb
		do i=1,norb
			val=0.5D0*(Qslice(i,j)+Qslice(j,i))
			Qmo(ia,i,j)=val
		end do
	end do
	!$OMP end parallel do
end do
deallocate(Clow,Qslice)
end subroutine


!------ Build Becke atomic population matrices Q^A in active MO basis: Qmo(ia, i, j)
subroutine slmo_build_Qmo_becke(nbasis,norb,ncenter,Cact,AOMbas,Qmo,nthreads)
implicit none
integer,intent(in) :: nbasis,norb,ncenter,nthreads
real*8,intent(in) :: Cact(nbasis,norb),AOMbas(nbasis,nbasis,ncenter)
real*8,intent(out) :: Qmo(ncenter,norb,norb)
integer :: ia,i,j
real*8 :: val
real*8,allocatable :: AOMtmp(:,:),Qslice(:,:)

allocate(AOMtmp(nbasis,norb),Qslice(norb,norb))
do ia=1,ncenter
	call dgemm('N','N',nbasis,norb,nbasis,1D0,AOMbas(1,1,ia),nbasis,Cact,nbasis,0D0,AOMtmp,nbasis)
	call dgemm('T','N',norb,norb,nbasis,1D0,Cact,nbasis,AOMtmp,nbasis,0D0,Qslice,norb)
	!$OMP parallel do default(none) shared(Qmo,Qslice,ia,norb) private(i,j,val) num_threads(nthreads)
	do j=1,norb
		do i=1,norb
			val=0.5D0*(Qslice(i,j)+Qslice(j,i))
			Qmo(ia,i,j)=val
		end do
	end do
	!$OMP end parallel do
end do
deallocate(AOMtmp,Qslice)
end subroutine


!------ Transform AO Fock matrix Fmat_ao into active MO basis
subroutine slmo_build_Fmo_ao(nbasis,norb,Cact,Fmat_ao,Fmat_mo)
implicit none
integer,intent(in) :: nbasis,norb
real*8,intent(in) :: Cact(nbasis,norb),Fmat_ao(nbasis,nbasis)
real*8,intent(out) :: Fmat_mo(norb,norb)
integer :: i,j
real*8 :: val
real*8,allocatable :: tmp(:,:)

allocate(tmp(nbasis,norb))
call dgemm('N','N',nbasis,norb,nbasis,1D0,Fmat_ao,nbasis,Cact,nbasis,0D0,tmp,nbasis)
call dgemm('T','N',norb,norb,nbasis,1D0,Cact,nbasis,tmp,nbasis,0D0,Fmat_mo,norb)
do j=1,norb
	do i=j+1,norb
		val=0.5D0*(Fmat_mo(i,j)+Fmat_mo(j,i))
		Fmat_mo(i,j)=val
		Fmat_mo(j,i)=val
	end do
end do
deallocate(tmp)
end subroutine


!------ Build diagonal MO Fock matrix from canonical orbital energies MOene
subroutine slmo_build_Fmo_ene(nbasis,norb,orblist,MOene_arr,Fmat_mo,fock_ok)
implicit none
integer,intent(in) :: nbasis,norb,orblist(norb)
real*8,intent(in) :: MOene_arr(nbasis)
real*8,intent(out) :: Fmat_mo(norb,norb)
logical,intent(out) :: fock_ok
integer :: i
real*8 :: emin,emax,ev

Fmat_mo=0D0
if (norb<=0) then
	fock_ok=.false.
	return
end if
emin=MOene_arr(orblist(1))
emax=emin
do i=1,norb
	ev=MOene_arr(orblist(i))
	Fmat_mo(i,i)=ev
	if (ev<emin) emin=ev
	if (ev>emax) emax=ev
end do
if (emax-emin>1D-6) then
	fock_ok=.true.
else
	fock_ok=.false.
end if
end subroutine


!------ Build Localization-Frustration Operator Omega = sum_{A<B} [Q^A, Q^B]^T [Q^A, Q^B]
!       and Fock-free Intrinsic Bond-Order Operator H_BO = -sum_{A<B} Tr(Q^A Q^B) (Q^A Q^B + Q^B Q^A)
subroutine slmo_build_omega_Hbo(nmat_Q,norb,Qmo,Omega,Hbo,nthreads)
implicit none
integer,intent(in) :: nmat_Q,norb,nthreads
real*8,intent(in) :: Qmo(nmat_Q,norb,norb)
real*8,intent(out) :: Omega(norb,norb),Hbo(norb,norb)
integer :: ia,ib,i,j
real*8 :: wAB
real*8,allocatable :: Qlist(:,:,:),AB(:,:),comm(:,:),Om_priv(:,:),H_priv(:,:)

allocate(Qlist(norb,norb,nmat_Q))
!$OMP parallel do default(none) shared(Qlist,Qmo,nmat_Q,norb) private(ia,i,j) num_threads(nthreads)
do ia=1,nmat_Q
	do j=1,norb
		do i=1,norb
			Qlist(i,j,ia)=Qmo(ia,i,j)
		end do
	end do
end do
!$OMP end parallel do

Omega=0D0
Hbo=0D0
!$OMP parallel default(none) shared(nmat_Q,norb,Qlist,Omega,Hbo) &
!$OMP private(ia,ib,i,j,wAB,AB,comm,Om_priv,H_priv) num_threads(nthreads)
allocate(AB(norb,norb),comm(norb,norb),Om_priv(norb,norb),H_priv(norb,norb))
Om_priv=0D0
H_priv=0D0
!$OMP do schedule(dynamic)
do ia=1,nmat_Q
	do ib=ia+1,nmat_Q
		wAB=0D0
		do j=1,norb
			do i=1,norb
				wAB=wAB+Qlist(i,j,ia)*Qlist(i,j,ib)
			end do
		end do
		if (wAB<1D-11) cycle
		call dgemm('N','N',norb,norb,norb,1D0,Qlist(1,1,ia),norb,Qlist(1,1,ib),norb,0D0,AB,norb)
		do j=1,norb
			do i=1,norb
				comm(i,j)=AB(i,j)-AB(j,i)
				H_priv(i,j)=H_priv(i,j)-wAB*(AB(i,j)+AB(j,i))
			end do
		end do
		call dsyrk('U','T',norb,norb,1D0,comm,norb,1D0,Om_priv,norb)
	end do
end do
!$OMP end do
!$OMP critical
Omega=Omega+Om_priv
Hbo=Hbo+H_priv
!$OMP end critical
deallocate(AB,comm,Om_priv,H_priv)
!$OMP end parallel

do j=1,norb
	do i=j+1,norb
		Omega(i,j)=Omega(j,i)
	end do
end do
deallocate(Qlist)
end subroutine


!------ OpenMP MO-basis 2x2 Jacobi maximizer of sum_{i=1..norb} sum_{m=1..nmat} Omo(m,i,i)^2
!       Updates Omo in-place and returns accumulated orthogonal Umat(norb,norb)
subroutine slmo_jacobi_pm(nmat,norb,maxcyc,crit,Omo,Umat,icyc_out,Pval_out,label_str,nthreads)
implicit none
integer,intent(in) :: nmat,norb,maxcyc,nthreads
real*8,intent(in) :: crit
character(len=*),intent(in) :: label_str
real*8,intent(inout) :: Omo(nmat,norb,norb)
real*8,intent(out) :: Umat(norb,norb),Pval_out
integer,intent(out) :: icyc_out
integer :: neven,nhalf,icyc,iround,ipair,idx,jdx,imat,irot,irow,icol,n_rot,itmp
real*8 :: Pvalold,Pval,deltaPval,Aval,Bval,Qii,Qjj,Qij,gamma,cg,sg,tmp1,tmp2,gam_tol
integer,allocatable :: top_orb(:),bot_orb(:),rot_i(:),rot_j(:)
logical,allocatable :: pair_rot(:)
real*8,allocatable :: pair_c(:),pair_s(:),rot_c(:),rot_s(:)

Umat=0D0
do idx=1,norb
	Umat(idx,idx)=1D0
end do
Pvalold=0D0
do idx=1,norb
	do imat=1,nmat
		Pvalold=Pvalold+Omo(imat,idx,idx)**2
	end do
end do
Pval_out=Pvalold
if (norb<=1.or.nmat<=0) then
	icyc_out=1
	return
end if

neven=norb+mod(norb,2)
nhalf=neven/2
gam_tol=1D-10
allocate(top_orb(nhalf),bot_orb(nhalf),pair_rot(nhalf),pair_c(nhalf),pair_s(nhalf), &
         rot_i(nhalf),rot_j(nhalf),rot_c(nhalf),rot_s(nhalf))

write(*,"(' Initial ',a,':',f16.8)") trim(label_str),Pvalold
icyc_out=maxcyc+1
do icyc=1,maxcyc
	do ipair=1,nhalf
		top_orb(ipair)=ipair
		bot_orb(ipair)=neven-ipair+1
	end do

	!$OMP parallel default(none) &
	!$OMP shared(nmat,norb,neven,nhalf,Omo,Umat,top_orb,bot_orb, &
	!$OMP        pair_rot,pair_c,pair_s,rot_i,rot_j,rot_c,rot_s,n_rot,gam_tol) &
	!$OMP private(iround,ipair,idx,jdx,imat,Aval,Bval,Qii,Qjj,Qij,gamma,cg,sg, &
	!$OMP         irot,irow,icol,tmp1,tmp2,itmp) num_threads(nthreads)
	do iround=1,neven-1
		!$OMP do schedule(static)
		do ipair=1,nhalf
			pair_rot(ipair)=.false.
			idx=top_orb(ipair)
			jdx=bot_orb(ipair)
			if (idx>norb.or.jdx>norb) cycle
			Aval=0D0
			Bval=0D0
			do imat=1,nmat
				Qii=Omo(imat,idx,idx)
				Qjj=Omo(imat,jdx,jdx)
				Qij=Omo(imat,idx,jdx)
				Aval=Aval+Qij*Qij-0.25D0*(Qii-Qjj)**2
				Bval=Bval+Qij*(Qii-Qjj)
			end do
			if (Aval*Aval+Bval*Bval<1D-14) cycle
			gamma=0.25D0*atan2(Bval,-Aval)
			if (abs(gamma)<gam_tol) cycle
			pair_rot(ipair)=.true.
			pair_c(ipair)=cos(gamma)
			pair_s(ipair)=sin(gamma)
		end do
		!$OMP end do

		!$OMP single
		n_rot=0
		do ipair=1,nhalf
			if (pair_rot(ipair)) then
				n_rot=n_rot+1
				rot_i(n_rot)=top_orb(ipair)
				rot_j(n_rot)=bot_orb(ipair)
				rot_c(n_rot)=pair_c(ipair)
				rot_s(n_rot)=pair_s(ipair)
			end if
		end do
		!$OMP end single

		if (n_rot>0) then
			!$OMP do schedule(static)
			do irot=1,n_rot
				idx=rot_i(irot)
				jdx=rot_j(irot)
				cg=rot_c(irot)
				sg=rot_s(irot)
				do irow=1,norb
					do imat=1,nmat
						tmp1=Omo(imat,irow,idx)
						tmp2=Omo(imat,irow,jdx)
						Omo(imat,irow,idx)=cg*tmp1+sg*tmp2
						Omo(imat,irow,jdx)=-sg*tmp1+cg*tmp2
					end do
				end do
				do irow=1,norb
					tmp1=Umat(irow,idx)
					tmp2=Umat(irow,jdx)
					Umat(irow,idx)=cg*tmp1+sg*tmp2
					Umat(irow,jdx)=-sg*tmp1+cg*tmp2
				end do
			end do
			!$OMP end do

			!$OMP do schedule(static)
			do icol=1,norb
				do irot=1,n_rot
					idx=rot_i(irot)
					jdx=rot_j(irot)
					cg=rot_c(irot)
					sg=rot_s(irot)
					do imat=1,nmat
						tmp1=Omo(imat,idx,icol)
						tmp2=Omo(imat,jdx,icol)
						Omo(imat,idx,icol)=cg*tmp1+sg*tmp2
						Omo(imat,jdx,icol)=-sg*tmp1+cg*tmp2
					end do
				end do
			end do
			!$OMP end do
		end if

		!$OMP single
		if (nhalf>1) then
			itmp=bot_orb(1)
			do ipair=1,nhalf-1
				bot_orb(ipair)=bot_orb(ipair+1)
			end do
			bot_orb(nhalf)=top_orb(nhalf)
			do ipair=nhalf,3,-1
				top_orb(ipair)=top_orb(ipair-1)
			end do
			top_orb(2)=itmp
		end if
		!$OMP end single
	end do
	!$OMP end parallel

	Pval=0D0
	do idx=1,norb
		do imat=1,nmat
			Pval=Pval+Omo(imat,idx,idx)**2
		end do
	end do
	deltaPval=Pval-Pvalold
	write(*,"(' Cycle:',i5,'  ',a,':',f16.8,'  Delta:',f16.8)") icyc,trim(label_str),Pval,deltaPval
	Pval_out=Pval
	if (abs(deltaPval)<crit) then
		icyc_out=icyc
		exit
	end if
	Pvalold=Pval
end do
deallocate(top_orb,bot_orb,pair_rot,pair_c,pair_s,rot_i,rot_j,rot_c,rot_s)
end subroutine


!------ Connected components of an undirected graph via BFS
subroutine slmo_connected_components(n,adj,labels,ncomp)
implicit none
integer,intent(in) :: n,adj(n,n)
integer,intent(out) :: labels(n),ncomp
integer :: i,j,head,tail,cur
integer,allocatable :: queue(:)

allocate(queue(n))
labels=0
ncomp=0
do i=1,n
	if (labels(i)/=0) cycle
	ncomp=ncomp+1
	labels(i)=ncomp
	head=1
	tail=1
	queue(1)=i
	do while (head<=tail)
		cur=queue(head)
		head=head+1
		do j=1,n
			if (labels(j)==0.and.adj(cur,j)/=0) then
				labels(j)=ncomp
				tail=tail+1
				queue(tail)=j
			end if
		end do
	end do
end do
deallocate(queue)
end subroutine


!------ Greedy Newman-Girvan modularity community refinement on weighted graph Wmat
!       Splits large connected components (>=4 nodes) into strongly cohesive Clar-like communities
subroutine slmo_modularity_refine(n,Wmat,tau_floor,labels,ncomp)
implicit none
integer,intent(in) :: n
real*8,intent(in) :: Wmat(n,n),tau_floor
integer,intent(inout) :: labels(n),ncomp
integer :: c,cnt,i,j,k,u,v,c_old,c_best,c_cand,isweep,new_ncomp,nc_sub
logical :: moved
real*8 :: twom,ki,w_old,w_cand,dq,best_dq,k_old_rem
integer,allocatable :: idx(:),sub_lab(:),new_labels(:),remap(:)
real*8,allocatable :: Wsub(:,:),kdeg(:),Ktot(:),w_to_c(:)

allocate(idx(n),new_labels(n))
new_labels=0
new_ncomp=0

do c=1,ncomp
	cnt=0
	do i=1,n
		if (labels(i)==c) then
			cnt=cnt+1
			idx(cnt)=i
		end if
	end do
	if (cnt<4) then
		new_ncomp=new_ncomp+1
		do i=1,cnt
			new_labels(idx(i))=new_ncomp
		end do
		cycle
	end if

	allocate(Wsub(cnt,cnt),kdeg(cnt),Ktot(cnt),w_to_c(cnt),sub_lab(cnt),remap(cnt))
	Wsub=0D0
	do j=1,cnt
		do i=1,cnt
			if (i/=j.and.Wmat(idx(i),idx(j))>tau_floor) Wsub(i,j)=Wmat(idx(i),idx(j))
		end do
	end do
	twom=0D0
	do i=1,cnt
		kdeg(i)=sum(Wsub(:,i))
		twom=twom+kdeg(i)
		sub_lab(i)=i
		Ktot(i)=kdeg(i)
	end do
	if (twom>1D-14) then
		do isweep=1,50
			moved=.false.
			do u=1,cnt
				c_old=sub_lab(u)
				ki=kdeg(u)
				w_to_c=0D0
				do v=1,cnt
					if (v/=u.and.Wsub(u,v)>0D0) then
						w_to_c(sub_lab(v))=w_to_c(sub_lab(v))+Wsub(u,v)
					end if
				end do
				k_old_rem=Ktot(c_old)-ki
				w_old=w_to_c(c_old)
				best_dq=1D-12
				c_best=c_old
				do v=1,cnt
					if (v==u.or.Wsub(u,v)<=0D0) cycle
					c_cand=sub_lab(v)
					if (c_cand==c_old) cycle
					w_cand=w_to_c(c_cand)
					dq=(w_cand-ki*Ktot(c_cand)/twom)-(w_old-ki*k_old_rem/twom)
					if (dq>best_dq) then
						best_dq=dq
						c_best=c_cand
					end if
				end do
				if (c_best/=c_old) then
					Ktot(c_old)=Ktot(c_old)-ki
					Ktot(c_best)=Ktot(c_best)+ki
					sub_lab(u)=c_best
					moved=.true.
				end if
			end do
			if (.not.moved) exit
		end do
	end if

	remap=0
	nc_sub=0
	do i=1,cnt
		k=sub_lab(i)
		if (remap(k)==0) then
			nc_sub=nc_sub+1
			new_ncomp=new_ncomp+1
			remap(k)=new_ncomp
		end if
		new_labels(idx(i))=remap(k)
	end do
	deallocate(Wsub,kdeg,Ktot,w_to_c,sub_lab,remap)
end do

labels=new_labels
ncomp=new_ncomp
deallocate(idx,new_labels)
end subroutine


!------ Master driver for all semi-localization algorithms (imethod=21..24)
subroutine slmo_driver(imethod,nmat_Q,norb,Qmo,Fmat_mo,fock_ok,orblist,atm_id, &
	islmo_Htype,islmo_clust,islmo_m,slmo_w0,slmo_lamsep,slmo_eps0,slmo_lamH,slmo_tau,slmo_Bcut, &
	maxcyc,crit,Umat,icyc_out,nth)
use defvar
use util
implicit none
integer,intent(in) :: imethod,nmat_Q,norb,orblist(norb),atm_id(nmat_Q),islmo_Htype,islmo_clust,islmo_m,maxcyc,nth
real*8,intent(in) :: Qmo(nmat_Q,norb,norb),Fmat_mo(norb,norb),slmo_w0,slmo_lamsep,slmo_eps0,slmo_lamH,slmo_tau,slmo_Bcut,crit
logical,intent(in) :: fock_ok
real*8,intent(out) :: Umat(norb,norb)
integer,intent(out) :: icyc_out
integer :: i,j,k,ia,ib,istat,n_loc,n_del,ncomp,c,cnt,n_isl,n_isl_eff,n_act_at,m,m_best,icyc_loc,icyc_del,ntop
real*8 :: wk,rk,gk,denom,hbar,lam_H_eff,Pval,qmax,val
logical :: has_omega,use_fock
real*8,allocatable :: Omega(:,:),Hbo(:,:),Om_tmp(:,:),V_om(:,:),w_evals(:),g_vals(:)
real*8,allocatable :: Gmat(:,:),Ghalf(:,:),Huse(:,:),Hshift(:,:),Htilde(:,:),tmp(:,:),Omo(:,:,:)
real*8,allocatable :: U_pm(:,:),Mmat(:,:),H_pm(:,:),U_blk(:,:),Hsub(:,:),Vsub(:,:),eval_sub(:),topM(:)
real*8,allocatable :: V_loc(:,:),V_del(:,:),Q_loc(:,:,:),Q_del(:,:,:),U_loc(:,:),H_del(:,:)
real*8,allocatable :: p_del(:),B_del(:,:),Q_isl(:,:,:),U_isl(:,:),H_isl(:,:),U_sub(:,:),U_del_tot(:,:)
integer,allocatable :: adj(:,:),labels(:),idx(:),loc_idx(:),del_idx(:),act_at(:),at_lab(:),orb_isl(:)

allocate(w_evals(norb))
w_evals=0D0
has_omega=.false.
icyc_out=1

if (norb<=1) then
	Umat=0D0
	if (norb==1) Umat(1,1)=1D0
	deallocate(w_evals)
	return
end if

if (imethod==21.or.imethod==22) then
	!--------------------------------------------------------------------------
	! Algorithm 1: Frustration-Gated Augmented Pipek-Mezey (Omega-F-PM / Omega-HBO-PM)
	!--------------------------------------------------------------------------
	allocate(Omega(norb,norb),Hbo(norb,norb),Om_tmp(norb,norb),V_om(norb,norb),g_vals(norb), &
	         Gmat(norb,norb),Ghalf(norb,norb),Huse(norb,norb),Hshift(norb,norb),Htilde(norb,norb),tmp(norb,norb))
	write(*,*) "Building Localization-Frustration operator Omega..."
	call slmo_build_omega_Hbo(nmat_Q,norb,Qmo,Omega,Hbo,nth)
	Om_tmp=Omega
	call diagsymat(Om_tmp,V_om,w_evals,istat)
	has_omega=.true.

	do k=1,norb
		wk=max(0D0,w_evals(k))
		if (slmo_w0<=0D0) then
			gk=1D0
		else if (wk<=slmo_w0) then
			rk=(wk/slmo_w0)**islmo_m
			gk=rk/(1D0+rk)
		else
			rk=(slmo_w0/wk)**islmo_m
			gk=1D0/(1D0+rk)
		end if
		g_vals(k)=gk
	end do

	! G = V * diag(g) * V^T,  G^(1/2) = V * diag(sqrt(g)) * V^T
	do k=1,norb
		tmp(:,k)=V_om(:,k)*g_vals(k)
	end do
	call dgemm('N','T',norb,norb,norb,1D0,tmp,norb,V_om,norb,0D0,Gmat,norb)
	do k=1,norb
		tmp(:,k)=V_om(:,k)*sqrt(g_vals(k))
	end do
	call dgemm('N','T',norb,norb,norb,1D0,tmp,norb,V_om,norb,0D0,Ghalf,norb)

	if (imethod==21) then
		if (fock_ok) then
			Huse=Fmat_mo
			lam_H_eff=1D0/(slmo_eps0*slmo_eps0)
			write(*,"(' Running Omega-F-PM (w0=',f7.4,', m=',i2,', lam_sep=',f6.1,', eps0=',f7.4,' Ha)...')") &
				slmo_w0,islmo_m,slmo_lamsep,slmo_eps0
		else
			write(*,*) "Note: Valid orbital energies/Fock matrix unavailable; automatically falling back to Fock-free H_BO!"
			Huse=Hbo
			lam_H_eff=slmo_lamH
		end if
	else
		Huse=Hbo
		lam_H_eff=slmo_lamH
		write(*,"(' Running Omega-HBO-PM (Fock-free, w0=',f7.4,', m=',i2,', lam_sep=',f6.1,', lam_H=',f7.1,')...')") &
			slmo_w0,islmo_m,slmo_lamsep,slmo_lamH
	end if

	denom=sum(g_vals)
	if (denom>1D-8) then
		hbar=sum(Gmat*Huse)/denom
		Hshift=Huse
		do i=1,norb
			Hshift(i,i)=Hshift(i,i)-hbar
		end do
		call dgemm('N','N',norb,norb,norb,1D0,Ghalf,norb,Hshift,norb,0D0,tmp,norb)
		call dgemm('N','N',norb,norb,norb,1D0,tmp,norb,Ghalf,norb,0D0,Htilde,norb)
		do j=1,norb
			do i=j+1,norb
				val=0.5D0*(Htilde(i,j)+Htilde(j,i))
				Htilde(i,j)=val
				Htilde(j,i)=val
			end do
		end do
	else
		Htilde=0D0
	end if

	allocate(Omo(nmat_Q+2,norb,norb))
	Omo(1:nmat_Q,:,:)=Qmo(:,:,:)
	Omo(nmat_Q+1,:,:)=sqrt(max(0D0,slmo_lamsep))*Gmat(:,:)
	Omo(nmat_Q+2,:,:)=sqrt(max(0D0,lam_H_eff))*Htilde(:,:)
	call slmo_jacobi_pm(nmat_Q+2,norb,maxcyc,crit,Omo,Umat,icyc_out,Pval,"P_SLMO",nth)
	deallocate(Omega,Hbo,Om_tmp,V_om,g_vals,Gmat,Ghalf,Huse,Hshift,Htilde,tmp,Omo)

else if (imethod==23) then
	!--------------------------------------------------------------------------
	! Algorithm 2: PM Delocalization-Graph Block Semi-Canonicalization (PM-GSC)
	!--------------------------------------------------------------------------
	write(*,"(' Stage 1: Running standard Pipek-Mezey localization...')")
	allocate(Omo(nmat_Q,norb,norb),U_pm(norb,norb),Mmat(norb,norb),adj(norb,norb),labels(norb),idx(norb))
	Omo=Qmo
	call slmo_jacobi_pm(nmat_Q,norb,maxcyc,crit,Omo,U_pm,icyc_out,Pval,"P_PM",nth)

	! Build pairwise orbital frustration matrix M_ij = sum_A (Q^A_PM(i,j))^2
	Mmat=0D0
	adj=0
	!$OMP parallel do default(none) shared(norb,nmat_Q,Omo,Mmat,adj,slmo_tau) private(i,j,ia,val) num_threads(nth)
	do j=1,norb
		do i=j+1,norb
			val=0D0
			do ia=1,nmat_Q
				val=val+Omo(ia,i,j)**2
			end do
			Mmat(i,j)=val
			Mmat(j,i)=val
			if (val>slmo_tau) then
				adj(i,j)=1
				adj(j,i)=1
			end if
		end do
	end do
	!$OMP end parallel do

	! Print top pairwise M_ij values to help inspect the gap
	ntop=min(10,norb*(norb-1)/2)
	if (ntop>0) then
		allocate(topM(norb*(norb-1)/2))
		k=0
		do j=1,norb
			do i=j+1,norb
				k=k+1
				topM(k)=Mmat(i,j)
			end do
		end do
		call sort(topM,"val")
		write(*,"(' Top pairwise M_ij (PM basis):',10f8.4)") (topM(k-i+1),i=1,ntop)
		deallocate(topM)
	end if

	call slmo_connected_components(norb,adj,labels,ncomp)
	if (islmo_clust==2) then
		write(*,*) "Stage 2: Refining multicenter clusters via weighted modularity maximization..."
		call slmo_modularity_refine(norb,Mmat,slmo_tau,labels,ncomp)
	end if

	allocate(H_pm(norb,norb),U_blk(norb,norb),tmp(norb,norb))
	use_fock=(islmo_Htype==1.and.fock_ok)
	if (islmo_Htype==1.and.(.not.fock_ok)) then
		write(*,*) "Note: Valid orbital energies/Fock matrix unavailable; using Fock-free H_BO inside clusters!"
	end if
	if (use_fock) then
		call dgemm('N','N',norb,norb,norb,1D0,Fmat_mo,norb,U_pm,norb,0D0,tmp,norb)
		call dgemm('T','N',norb,norb,norb,1D0,U_pm,norb,tmp,norb,0D0,H_pm,norb)
	else
		allocate(Omega(norb,norb))
		call slmo_build_omega_Hbo(nmat_Q,norb,Omo,Omega,H_pm,nth)
		deallocate(Omega)
	end if

	U_blk=0D0
	do i=1,norb
		U_blk(i,i)=1D0
	end do
	k=0
	do c=1,ncomp
		cnt=0
		do i=1,norb
			if (labels(i)==c) then
				cnt=cnt+1
				idx(cnt)=i
			end if
		end do
		if (cnt>=2) then
			k=k+1
			write(*,"(' Detected multicenter cluster',i3,' (size=',i3,'): PM-LMO indices ',20i4)") &
				k,cnt,(idx(i),i=1,min(cnt,20))
			allocate(Hsub(cnt,cnt),Vsub(cnt,cnt),eval_sub(cnt))
			do j=1,cnt
				do i=1,cnt
					Hsub(i,j)=0.5D0*(H_pm(idx(i),idx(j))+H_pm(idx(j),idx(i)))
				end do
			end do
			call diagsymat(Hsub,Vsub,eval_sub,istat)
			do j=1,cnt
				do i=1,cnt
					U_blk(idx(i),idx(j))=Vsub(i,j)
				end do
			end do
			deallocate(Hsub,Vsub,eval_sub)
		end if
	end do
	if (k==0) write(*,"(' No multicenter clusters found above tau=',f8.4,' (retaining standard PM LMOs)')") slmo_tau

	call dgemm('N','N',norb,norb,norb,1D0,U_pm,norb,U_blk,norb,0D0,Umat,norb)
	deallocate(Omo,U_pm,Mmat,adj,labels,idx,H_pm,U_blk,tmp)

else if (imethod==24) then
	!--------------------------------------------------------------------------
	! Algorithm 3: Spectral Omega-Split + Island Semi-Localization
	!--------------------------------------------------------------------------
	allocate(Omega(norb,norb),Hbo(norb,norb),Om_tmp(norb,norb),V_om(norb,norb),loc_idx(norb),del_idx(norb))
	write(*,*) "Building and diagonalizing Localization-Frustration operator Omega..."
	call slmo_build_omega_Hbo(nmat_Q,norb,Qmo,Omega,Hbo,nth)
	Om_tmp=Omega
	call diagsymat(Om_tmp,V_om,w_evals,istat)
	has_omega=.true.

	n_loc=0
	n_del=0
	do k=1,norb
		if (w_evals(k)>slmo_w0) then
			n_del=n_del+1
			del_idx(n_del)=k
		else
			n_loc=n_loc+1
			loc_idx(n_loc)=k
		end if
	end do
	write(*,"(' Spectral Omega split (w_cut=',f7.4,'): dim(V_loc)=',i4,', dim(V_deloc)=',i4)") &
		slmo_w0,n_loc,n_del

	Umat=0D0
	icyc_loc=1
	icyc_del=1

	! Part 1: Standard PM inside localized subspace V_loc
	if (n_loc>=1) then
		allocate(V_loc(norb,n_loc))
		do k=1,n_loc
			V_loc(:,k)=V_om(:,loc_idx(k))
		end do
		if (n_loc>=2) then
			write(*,*) "Localizing classical subspace V_loc with Pipek-Mezey..."
			allocate(Q_loc(nmat_Q,n_loc,n_loc),U_loc(n_loc,n_loc),tmp(norb,n_loc),Hsub(n_loc,n_loc))
			do ia=1,nmat_Q
				do j=1,norb
					do i=1,norb
						Om_tmp(i,j)=Qmo(ia,i,j)
					end do
				end do
				call dgemm('N','N',norb,n_loc,norb,1D0,Om_tmp,norb,V_loc,norb,0D0,tmp,norb)
				call dgemm('T','N',n_loc,n_loc,norb,1D0,V_loc,norb,tmp,norb,0D0,Hsub,n_loc)
				do j=1,n_loc
					do i=1,n_loc
						Q_loc(ia,i,j)=0.5D0*(Hsub(i,j)+Hsub(j,i))
					end do
				end do
			end do
			call slmo_jacobi_pm(nmat_Q,n_loc,maxcyc,crit,Q_loc,U_loc,icyc_loc,Pval,"P_loc",nth)
			call dgemm('N','N',norb,n_loc,n_loc,1D0,V_loc,norb,U_loc,n_loc,0D0,Umat(1,1),norb)
			deallocate(Q_loc,U_loc,tmp,Hsub)
		else
			Umat(:,1)=V_loc(:,1)
		end if
		deallocate(V_loc)
	end if

	! Part 2: Island Fragment-PM + intra-island diagonalization inside V_deloc
	if (n_del>=1) then
		allocate(V_del(norb,n_del),Q_del(nmat_Q,n_del,n_del),H_del(n_del,n_del),tmp(norb,n_del),Hsub(n_del,n_del))
		do k=1,n_del
			V_del(:,k)=V_om(:,del_idx(k))
		end do
		do ia=1,nmat_Q
			do j=1,norb
				do i=1,norb
					Om_tmp(i,j)=Qmo(ia,i,j)
				end do
			end do
			call dgemm('N','N',norb,n_del,norb,1D0,Om_tmp,norb,V_del,norb,0D0,tmp,norb)
			call dgemm('T','N',n_del,n_del,norb,1D0,V_del,norb,tmp,norb,0D0,Hsub,n_del)
			do j=1,n_del
				do i=1,n_del
					Q_del(ia,i,j)=0.5D0*(Hsub(i,j)+Hsub(j,i))
				end do
			end do
		end do

		allocate(Huse(norb,norb))
		use_fock=(islmo_Htype==1.and.fock_ok)
		if (islmo_Htype==1.and.(.not.fock_ok)) then
			write(*,*) "Note: Valid orbital energies/Fock matrix unavailable; using Fock-free H_BO inside islands!"
		end if
		if (use_fock) then
			Huse=Fmat_mo
		else
			Huse=Hbo
		end if
		call dgemm('N','N',norb,n_del,norb,1D0,Huse,norb,V_del,norb,0D0,tmp,norb)
		call dgemm('T','N',n_del,n_del,norb,1D0,V_del,norb,tmp,norb,0D0,H_del,n_del)
		do j=1,n_del
			do i=j+1,n_del
				val=0.5D0*(H_del(i,j)+H_del(j,i))
				H_del(i,j)=val
				H_del(j,i)=val
			end do
		end do
		deallocate(Huse,tmp,Hsub)

		! Identify active delocalized atoms and connected conjugated islands via B_AB^deloc
		allocate(p_del(nmat_Q),act_at(nmat_Q))
		n_act_at=0
		do ia=1,nmat_Q
			val=0D0
			do i=1,n_del
				val=val+Q_del(ia,i,i)
			end do
			p_del(ia)=val
			if (val>0.05D0) then
				n_act_at=n_act_at+1
				act_at(n_act_at)=ia
			end if
		end do

		n_isl=0
		if (n_act_at>=1) then
			allocate(B_del(n_act_at,n_act_at),adj(n_act_at,n_act_at),at_lab(n_act_at))
			B_del=0D0
			adj=0
			do j=1,n_act_at
				ib=act_at(j)
				do i=j+1,n_act_at
					ia=act_at(i)
					val=2D0*sum(Q_del(ia,:,:)*Q_del(ib,:,:))
					B_del(i,j)=val
					B_del(j,i)=val
					if (val>slmo_Bcut) then
						adj(i,j)=1
						adj(j,i)=1
					end if
				end do
			end do
			call slmo_connected_components(n_act_at,adj,at_lab,n_isl)
			do m=1,n_isl
				write(*,"(' Conjugated atom island',i3,':')",advance='no') m
				cnt=0
				do i=1,n_act_at
					if (at_lab(i)==m) then
						ia=atm_id(act_at(i))
						cnt=cnt+1
						if (cnt<=16) write(*,"(i4,'(',a,')')",advance='no') ia,trim(a(ia)%name)
					end if
				end do
				if (cnt>16) write(*,"(' ... (total',i4,' atoms)')",advance='no') cnt
				write(*,*)
			end do
		end if

		if (n_isl>=2.and.n_del>=2) then
			! Fragment-PM over islands + residual atoms to separate disjoint aromatic rings
			n_isl_eff=n_isl+1
			allocate(Q_isl(n_isl_eff,n_del,n_del),U_isl(n_del,n_del),H_isl(n_del,n_del), &
			         orb_isl(n_del),U_sub(n_del,n_del),U_del_tot(n_del,n_del),idx(n_del))
			Q_isl=0D0
			do i=1,n_act_at
				m=at_lab(i)
				Q_isl(m,:,:)=Q_isl(m,:,:)+Q_del(act_at(i),:,:)
			end do
			! Residual non-active atoms
			do ia=1,nmat_Q
				if (p_del(ia)<=0.05D0) Q_isl(n_isl_eff,:,:)=Q_isl(n_isl_eff,:,:)+Q_del(ia,:,:)
			end do
			write(*,*) "Separating delocalized subspace across conjugated islands (Fragment-PM)..."
			call slmo_jacobi_pm(n_isl_eff,n_del,maxcyc,crit,Q_isl,U_isl,icyc_del,Pval,"P_isl",nth)

			allocate(tmp(n_del,n_del))
			call dgemm('N','N',n_del,n_del,n_del,1D0,H_del,n_del,U_isl,n_del,0D0,tmp,n_del)
			call dgemm('T','N',n_del,n_del,n_del,1D0,U_isl,n_del,tmp,n_del,0D0,H_isl,n_del)
			deallocate(tmp)

			do i=1,n_del
				qmax=-1D0
				m_best=1
				do m=1,n_isl
					if (Q_isl(m,i,i)>qmax) then
						qmax=Q_isl(m,i,i)
						m_best=m
					end if
				end do
				orb_isl(i)=m_best
			end do

			U_sub=0D0
			do i=1,n_del
				U_sub(i,i)=1D0
			end do
			do m=1,n_isl
				cnt=0
				do i=1,n_del
					if (orb_isl(i)==m) then
						cnt=cnt+1
						idx(cnt)=i
					end if
				end do
				if (cnt>=2) then
					allocate(Hsub(cnt,cnt),Vsub(cnt,cnt),eval_sub(cnt))
					do j=1,cnt
						do i=1,cnt
							Hsub(i,j)=0.5D0*(H_isl(idx(i),idx(j))+H_isl(idx(j),idx(i)))
						end do
					end do
					call diagsymat(Hsub,Vsub,eval_sub,istat)
					do j=1,cnt
						do i=1,cnt
							U_sub(idx(i),idx(j))=Vsub(i,j)
						end do
					end do
					deallocate(Hsub,Vsub,eval_sub)
				end if
			end do
			call dgemm('N','N',n_del,n_del,n_del,1D0,U_isl,n_del,U_sub,n_del,0D0,U_del_tot,n_del)
			call dgemm('N','N',norb,n_del,n_del,1D0,V_del,norb,U_del_tot,n_del,0D0,Umat(1,n_loc+1),norb)
			deallocate(Q_isl,U_isl,H_isl,orb_isl,U_sub,U_del_tot,idx)
		else if (n_del>=2) then
			allocate(Vsub(n_del,n_del),eval_sub(n_del))
			call diagsymat(H_del,Vsub,eval_sub,istat)
			call dgemm('N','N',norb,n_del,n_del,1D0,V_del,norb,Vsub,n_del,0D0,Umat(1,n_loc+1),norb)
			deallocate(Vsub,eval_sub)
		else
			Umat(:,n_loc+1)=V_del(:,1)
		end if

		if (allocated(B_del)) deallocate(B_del,adj,at_lab)
		deallocate(p_del,act_at,V_del,Q_del,H_del)
	end if

	icyc_out=max(icyc_loc,icyc_del)
	deallocate(Omega,Hbo,Om_tmp,V_om,loc_idx,del_idx)
end if

call slmo_print_summary(nmat_Q,norb,Qmo,Fmat_mo,fock_ok,Umat,orblist,atm_id,w_evals,has_omega)
deallocate(w_evals)
end subroutine


!------ Print diagnostic summary of Omega eigenvalues and resulting semi-localized MOs
subroutine slmo_print_summary(nmat_Q,norb,Qmo,Fmat_mo,fock_ok,Umat,orblist,atm_id,w_evals,has_omega)
use defvar
use util
implicit none
integer,intent(in) :: nmat_Q,norb,orblist(norb),atm_id(nmat_Q)
real*8,intent(in) :: Qmo(nmat_Q,norb,norb),Fmat_mo(norb,norb),Umat(norb,norb),w_evals(norb)
logical,intent(in) :: fock_ok,has_omega
integer :: i,j,k,ia,ntop,n_deloc,n_loc,nshow,iatm
real*8 :: qsum2,neff_min,neff_max
real*8,allocatable :: Qslice(:,:),QU(:,:),qdiag(:,:),neff(:),fdiag(:),qcol(:)
integer,allocatable :: ord(:),aord(:)

if (has_omega) then
	ntop=min(12,norb)
	write(*,"(/,' Top eigenvalues of Localization-Frustration operator Omega:')")
	write(*,"(12f8.4)") (w_evals(norb-i+1),i=1,ntop)
end if

allocate(Qslice(norb,norb),QU(norb,norb),qdiag(nmat_Q,norb),neff(norb),fdiag(norb),ord(norb),qcol(nmat_Q),aord(nmat_Q))
do ia=1,nmat_Q
	do j=1,norb
		do i=1,norb
			Qslice(i,j)=Qmo(ia,i,j)
		end do
	end do
	call dgemm('N','N',norb,norb,norb,1D0,Qslice,norb,Umat,norb,0D0,QU,norb)
	do i=1,norb
		qdiag(ia,i)=sum(Umat(:,i)*QU(:,i))
	end do
end do

fdiag=0D0
if (fock_ok) then
	call dgemm('N','N',norb,norb,norb,1D0,Fmat_mo,norb,Umat,norb,0D0,QU,norb)
	do i=1,norb
		fdiag(i)=sum(Umat(:,i)*QU(:,i))
	end do
end if

n_deloc=0
n_loc=0
neff_min=1D9
neff_max=0D0
do i=1,norb
	qsum2=sum(qdiag(:,i)**2)
	if (qsum2>1D-12) then
		neff(i)=1D0/qsum2
	else
		neff(i)=dble(nmat_Q)
	end if
	ord(i)=i
	if (neff(i)>2.25D0) then
		n_deloc=n_deloc+1
	else
		n_loc=n_loc+1
		if (neff(i)<neff_min) neff_min=neff(i)
		if (neff(i)>neff_max) neff_max=neff(i)
	end if
end do

! Sort orbitals by n_eff descending for clear summary display
call sort(neff,"val",ord)
write(*,"(/,' Summary of semi-localization (effective number of centers n_eff = 1/sum_A q_A^2):')")
if (n_deloc>0) then
	write(*,"(' Multicenter / semi-localized orbitals (n_eff > 2.25, count =',i4,'):')") n_deloc
	do k=norb,1,-1
		if (neff(k)<=2.25D0) exit
		i=ord(k)
		if (fock_ok) then
			write(*,"('   MO',i5,'  n_eff=',f5.2,'  F_ii=',f9.4,' Ha |')",advance='no') orblist(i),neff(k),fdiag(i)
		else
			write(*,"('   MO',i5,'  n_eff=',f5.2,' |')",advance='no') orblist(i),neff(k)
		end if
		qcol=qdiag(:,i)
		do ia=1,nmat_Q
			aord(ia)=ia
		end do
		call sort(qcol,"val",aord)
		nshow=0
		do ia=nmat_Q,1,-1
			if (qcol(ia)<0.04D0.or.nshow>=10) exit
			iatm=atm_id(aord(ia))
			write(*,"(i4,'(',a,'):',f4.1,'%')",advance='no') iatm,trim(a(iatm)%name),qcol(ia)*100D0
			nshow=nshow+1
		end do
		write(*,*)
	end do
else
	write(*,*) " No multicenter orbitals with n_eff > 2.25 (all orbitals are 1c/2c localized)"
end if
if (n_loc>0) then
	write(*,"(' Localized 1c/2c orbitals (n_eff <= 2.25): count =',i5,', n_eff range = [',f4.2,',',f4.2,']')") &
		n_loc,neff_min,neff_max
end if

deallocate(Qslice,QU,qdiag,neff,fdiag,ord,qcol,aord)
end subroutine
