#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 uv_attrib;
layout(location = 2) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 uv;
out vec3 normal;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = (m*vec4(position_attrib, 1)).xyz;
    uv = uv_attrib;
    normal = mat3(transpose(inverse(m)))*normal_attrib;
}