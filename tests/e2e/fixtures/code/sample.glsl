// GLSL fragment shader: uniforms, vec math, main.
#version 330 core
precision highp float;

uniform sampler2D uTexture;
uniform float uTime;
in vec2 vUv;
out vec4 fragColor;

vec3 tint(vec3 c, float t) {
    return mix(c, vec3(0.48, 0.23, 0.93), 0.5 + 0.5 * sin(t));
}

void main() {
    vec4 tex = texture(uTexture, vUv);
    if (tex.a < 0.01) discard;
    fragColor = vec4(tint(tex.rgb, uTime), tex.a);
}
