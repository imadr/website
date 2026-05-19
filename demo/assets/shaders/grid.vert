#version 300 es
layout(location = 0) in vec3 position_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 near_point;
out vec3 far_point;

vec3 unproject_point(float x, float y, float z, mat4 v, mat4 p){
    mat4 v_inv = inverse(v);
    mat4 p_inv = inverse(p);
    vec4 unprojected_point = v_inv*p_inv*vec4(x, y, z, 1.0);
    return unprojected_point.xyz / unprojected_point.w;
}

void main(){
    near_point = unproject_point(position_attrib.x, position_attrib.y, 0.0, v, p).xyz;
    far_point = unproject_point(position_attrib.x, position_attrib.y, 1.0, v, p).xyz;
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
}