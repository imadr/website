#version 300 es
precision highp float;

out vec4 frag_color;

uniform mat4 v;
uniform mat4 p;

in vec3 position;
in vec3 near_point;
in vec3 far_point;

vec4 grid(vec3 frag_pos, float scale){
    vec2 coord = frag_pos.xz*scale;
    vec2 derivative = fwidth(coord);
    vec2 grid = abs(fract(coord-0.5)-0.5)/derivative;
    float line = min(grid.x, grid.y);
    vec3 color = vec3(0.2);
    float minimum_x = min(derivative.x, 1.0);
    float minimum_z = min(derivative.y, 1.0);
    if(frag_pos.x > -1.0 * minimum_x && frag_pos.x < 1.0 * minimum_x){
        color = vec3(0, 0, 1);
    }
    if(frag_pos.z > -1.0 * minimum_z && frag_pos.z < 1.0 * minimum_z){
        color = vec3(1, 0, 0);
    }
    return vec4(color, 1.0-line);
}

float depth(vec3 frag_pos){
    vec4 clip_space_pos = p*v*vec4(frag_pos, 1.0);
    float clip_space_depth = clip_space_pos.z/clip_space_pos.w;
    float far = gl_DepthRange.far;
    float near = gl_DepthRange.near;
    float depth = (((far-near)*clip_space_depth)+near+far)/2.0;
    return depth;
}

void main(){
    float t = -near_point.y/(far_point.y-near_point.y);
    vec3 frag_pos = near_point+t*(far_point-near_point);
    gl_FragDepth = depth(frag_pos);
    float spotlight = 1.0-length(frag_pos.xz)*0.04;
    spotlight = max(0.0, spotlight);
    frag_color = grid(frag_pos, 1.0)*float(t > 0.0)*spotlight;
}