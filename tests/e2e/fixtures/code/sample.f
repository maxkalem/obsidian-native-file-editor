! Fortran: modules, derived types, allocatable arrays, do loops.
module scanner
  implicit none
  integer, parameter :: limit = 5 * 1024 * 1024

  type :: note
    character(len=64) :: path
    integer :: size = 0
  end type note
contains
  integer function count_large(notes) result(n)
    type(note), intent(in) :: notes(:)
    integer :: i
    n = 0
    do i = 1, size(notes)
      if (notes(i)%size > limit) n = n + 1
    end do
  end function count_large
end module scanner

program main
  use scanner
  type(note) :: notes(2) = [note('a.md', 12), note('b.md', 6291456)]
  print '(A,I0)', 'large: ', count_large(notes)
end program main
