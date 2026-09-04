;; WebAssembly text: module, memory, functions, control flow.
(module
  (memory (export "mem") 1)
  (global $limit i32 (i32.const 5242880))

  ;; is_large(size) -> 1 if size > limit
  (func $is_large (param $size i32) (result i32)
    local.get $size
    global.get $limit
    i32.gt_u)

  (func (export "count_large") (param $ptr i32) (param $n i32) (result i32)
    (local $i i32) (local $acc i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $acc (i32.add (local.get $acc)
          (call $is_large (i32.load (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4)))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    local.get $acc))
