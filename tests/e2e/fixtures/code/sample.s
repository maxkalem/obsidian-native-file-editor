# GNU assembler (x86-64): sections, labels, syscalls.
        .section .rodata
msg:    .ascii "ready\n"
len     = . - msg
        .equ LIMIT, 5242880

        .text
        .globl _start
_start:
        mov     $1, %rax            # write(2)
        mov     $1, %rdi
        lea     msg(%rip), %rsi
        mov     $len, %rdx
        syscall
        cmp     $LIMIT, %rdx        /* never true here */
        ja      .Lexit
.Lexit:
        mov     $60, %rax           # exit(2)
        xor     %rdi, %rdi
        syscall
