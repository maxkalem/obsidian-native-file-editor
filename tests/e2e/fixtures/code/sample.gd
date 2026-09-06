# GDScript
extends Node2D
var speed: float = 200.0
func _process(delta: float) -> void:
    if Input.is_action_pressed("ui_right"):
        position.x += speed * delta
