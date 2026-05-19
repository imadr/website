#version 300 es
precision highp float;

out vec4 frag_color;

uniform sampler2D heightmap;
uniform float height_multiplier;
uniform float height_addend;

in vec3 position;

#define color1 vec3(0.003, 0.513, 0.976)
#define color2 vec3(0.003, 0.101, 0.976)

void main(){
    float height = texture(heightmap, position.xz/100.).r*height_multiplier+height_addend;
    if(height > 1.) discard;
    float t = 1.-height;
    if(t < 0.) t = 0.;
    if(t > 1.) t = 1.;
    frag_color = vec4(mix(color1, color2, t), 1.);
}