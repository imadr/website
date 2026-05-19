#version 300 es
layout(location = 0) in vec3 position_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

flat out vec3 position;

void main(){
    mat4 v_ = v;
    v_[3][2] = -3.0;
    gl_Position = p*v_*vec4(position_attrib, 1.0);
    position = position_attrib;
}