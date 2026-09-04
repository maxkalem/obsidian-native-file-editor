;; Scheme: define, let, named let, lists, higher-order functions.
(define limit (* 5 1024 1024))

(define (make-note path tags size) (list path tags size))
(define (note-tags n) (cadr n))
(define (note-size n) (caddr n))

(define (large? n) (> (note-size n) limit))

(define (group-by-tag notes)
  (let loop ((ns (filter (lambda (n) (not (large? n))) notes)) (acc '()))
    (if (null? ns)
        acc
        (loop (cdr ns)
              (fold-left (lambda (a t) (cons (cons t (car ns)) a)) acc (note-tags (car ns)))))))

(define (describe n)
  (cond ((= n 0) "no tags")
        ((> n 100) (string-append "many tags: " (number->string n)))
        (else (string-append (number->string n) " tags"))))

(display (describe (length (group-by-tag (list (make-note "a.md" '("x" "y") 12))))))
(newline)
