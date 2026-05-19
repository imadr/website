#version 300 es
precision highp float;

out vec4 frag_color;

uniform vec3 light_pos;
uniform vec3 view_pos;

in vec3 position;
in vec2 uv;
in vec3 normal;

void main(){
    vec3 light_direction = normalize(light_pos-position);
    vec3 view_dir = normalize(view_pos-position);
    vec3 norm = normalize(normal);
    vec3 reflect_dir = reflect(-light_direction, norm);
    float ambient = 0.1;
    float diffuse = max(dot(norm, light_direction), 0.0);
    float specular = pow(max(dot(view_dir, reflect_dir), 0.0), 32.0);
    float light = ambient+diffuse+specular;
    vec3 color = vec3(1, 0.5, 0.2);
    frag_color = vec4(color*light, 1);
}