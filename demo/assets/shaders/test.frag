#version 300 es
precision highp float;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    frag_color = vec4(normal, 1);
}