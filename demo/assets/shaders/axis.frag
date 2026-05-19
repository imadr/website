#version 300 es
precision highp float;

out vec4 frag_color;

flat in vec3 position;

void main(){
    frag_color = vec4(position, 1);
}