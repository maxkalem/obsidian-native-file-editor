;;; Common Lisp: defstruct, loop, format, keyword arguments.
(defpackage :nfe (:use :cl))
(in-package :nfe)

(defparameter *limit* (* 5 1024 1024))

(defstruct note path (tags '()) (size 0))

(defun group-by-tag (notes &key (limit *limit*))
  "Return an alist of tag -> notes, skipping large files."
  (let ((table (make-hash-table :test #'equal)))
    (loop for n in notes
          unless (> (note-size n) limit)
            do (dolist (tag (note-tags n))
                 (push n (gethash tag table))))
    table))

(format t "~A notes~%" (length (list (make-note :path "a.md" :tags '("x")))))
