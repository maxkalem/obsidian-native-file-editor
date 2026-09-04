# Cython: cdef classes, typed variables, C imports.
# cython: language_level=3
from libc.stdlib cimport malloc, free
cimport cython

cdef long LIMIT = 5 * 1024 * 1024

cdef class Note:
    cdef public str path
    cdef public long size

    def __cinit__(self, str path, long size=0):
        self.path = path
        self.size = size

    cpdef bint is_large(self):
        return self.size > LIMIT

@cython.boundscheck(False)
def count_large(long[:] sizes):
    cdef Py_ssize_t i, n = 0
    for i in range(sizes.shape[0]):
        if sizes[i] > LIMIT:
            n += 1
    return n  # a Python int
