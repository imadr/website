#version 300 es

layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 mvp;
uniform sampler2D heightmap;
uniform float height_multiplier;
uniform float height_addend;

out vec3 position;
out vec3 normal;

void main(){
    float height = texture(heightmap, position_attrib.xz/100.).r;
    gl_Position = mvp*vec4(position_attrib+vec3(0, height*height_multiplier+height_addend, 0), 1);
    position = position_attrib;
    normal = normal_attrib;
}