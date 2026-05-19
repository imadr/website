let ctx = {};


ctx.compile_shader = function(shader_source, shader_type){
    const gl = this.gl;
    let shader = gl.createShader(shader_type);
    gl.shaderSource(shader, shader_source);
    gl.compileShader(shader);
    if(!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){
        console.error("couldn't compile shader: "+gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

ctx.link_shader_program = function(vertex_shader_source, fragment_shader_source){
    const gl = this.gl;
    let vertex_shader = this.compile_shader(vertex_shader_source, gl.VERTEX_SHADER);
    if(vertex_shader == null) return null;

    let fragment_shader = this.compile_shader(fragment_shader_source, gl.FRAGMENT_SHADER);
    if(fragment_shader == null) return null;


    let shader_program = gl.createProgram();
    gl.attachShader(shader_program, vertex_shader);
    gl.attachShader(shader_program, fragment_shader);

    gl.linkProgram(shader_program);
    if(!gl.getProgramParameter(shader_program, gl.LINK_STATUS)){
        console.error("couldn't link shader program: "+gl.getProgramInfoLog(shader_program));
        return null;
    }
    return shader_program;
}

ctx.create_shader = function(vertex_shader_source, fragment_shader_source){
    const gl = this.gl;
    let program = this.link_shader_program(vertex_shader_source, fragment_shader_source);
    if(program == null) return null;
    let shader = {
        program: program,
        uniforms: {},
        attributes: {}
    };

    let n_uniforms = gl.getProgramParameter(shader.program, gl.ACTIVE_UNIFORMS);
    for(let i = 0; i < n_uniforms; i++){
        let uniform = gl.getActiveUniform(shader.program, i);
        shader.uniforms[uniform["name"]] = {
            type: uniform["type"],
            location: gl.getUniformLocation(shader.program, uniform["name"])
        };
    }

    let n_attributes = gl.getProgramParameter(shader.program, gl.ACTIVE_ATTRIBUTES);
    for(let i = 0; i < n_attributes; i++){
        let attribute = gl.getActiveAttrib(shader.program, i);
        shader.attributes[attribute["name"]] = {
            type: attribute["type"],
            location: gl.getAttribLocation(shader.program, attribute["name"])
        };
    }
    return shader;
}

ctx.set_shader_uniform = function(shader, uniform, value){
    const gl = this.gl;
    gl.useProgram(shader.program);
    if(!shader.uniforms.hasOwnProperty(uniform)) return;
    switch(shader.uniforms[uniform].type){
        case gl.UNSIGNED_INT:
            gl.uniform1ui(shader.uniforms[uniform].location, value);
            break;
        case gl.INT:
            gl.uniform1i(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT:
            gl.uniform1f(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC2:
            gl.uniform2fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC3:
            gl.uniform3fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_VEC4:
            gl.uniform4fv(shader.uniforms[uniform].location, value);
            break;
        case gl.FLOAT_MAT4:
            gl.uniformMatrix4fv(shader.uniforms[uniform].location, false, value);
            break;
        default:
            console.error("set_shader_uniform: unknown uniform type");
    }
}

ctx.create_vertex_buffer = function(vertices, attributes, indices){
    const gl = this.gl;
    let vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    let vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    let attribs_stride = 0;
    for(let attribute of attributes){
        attribs_stride += attribute.size;
    }

    let attrib_offset = 0;
    for(const [i, attribute] of attributes.entries()){
        gl.vertexAttribPointer(i, attribute.size, gl.FLOAT, false,
                               attribs_stride*Float32Array.BYTES_PER_ELEMENT,
                               attrib_offset*Float32Array.BYTES_PER_ELEMENT);
        attrib_offset += attribute.size;
        gl.enableVertexAttribArray(i);
    }

    let ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.DYNAMIC_DRAW);
    draw_count = indices.length;

    return {vao: vao, vbo: vbo, ebo: ebo, draw_count: draw_count, vertices: vertices, indices: indices, attributes: attributes};
}

function update_camera_projection_matrix(camera, aspect_ratio){
    let projection_matrix = perspective_projection(rad(camera.fov),
                                aspect_ratio,
                                camera.z_near,
                                camera.z_far);
    camera.projection_matrix = projection_matrix;
}

ctx.canvas = document.getElementById("main-canvas");
ctx.gl = ctx.canvas.getContext("webgl2", {stencil: true});
ctx.font_texture = ctx.gl.createTexture();
ctx.font = {chars:{}, data: {}};
ctx.text_buffers = {};
ctx.drawables = [];

ctx.scenes = {
    "scene_shape": {id: "scene_shape", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_normal": {id: "scene_normal", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_refraction": {id: "scene_refraction", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_reflection": {id: "scene_reflection", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_reflection_tex": {id: "scene_reflection_tex", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_refraction_reflection_tex": {id: "scene_refraction_reflection_tex", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_chromatic_aberration": {id: "scene_chromatic_aberration", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_sdf_mix": {id: "scene_sdf_mix", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_refraction_tex": {id: "scene_refraction_tex", el: null, ratio: 1.5, camera: null, dragging_rect: null, draggable_rects: {"scene": []},
        camera: {
            fov: 40, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
        },
        cursor_pos: [0.5, 0.5]
    },
    "scene_snells": {id: "scene_snells", el: null, ratio: 1.8, camera: null, dragging_rect: null, draggable_rects: {},
        camera: {
            fov: 50, z_near: 0.1, z_far: 1000,
            position: [0, 0, 0], rotation: [0, 0, 0],
            up_vector: [0, 1, 0],
            view_matrix: mat4_identity(),
            orbit: {
                rotation: [0, 0, 0],
                pivot: [0, 0, 0],
                zoom: 2.0
            }
        }
    },
};

ctx.update_drawable_mesh = function(drawable, mesh){
    const gl = this.gl;
    if(drawable.vertex_buffer != null){
        gl.deleteVertexArray(drawable.vertex_buffer.vao);
        gl.deleteBuffer(drawable.vertex_buffer.vbo);
        gl.deleteBuffer(drawable.vertex_buffer.ebo);
    }
    drawable.vertex_buffer = this.create_vertex_buffer(mesh.vertices, [
                            { name: 'position_attrib', size: 3 },
                            { name: 'normal_attrib', size: 3 }
                        ], mesh.indices);
}

ctx.shaders = {};
ctx.shaders["shader_shape"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform vec2 cursor_pos;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;
    frag_color = vec4(vec3(sdf), 1);
}`);
ctx.shaders["shader_normal"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform vec2 cursor_pos;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;
    frag_color = vec4(get_normal(sdf, u_thickness), 1);
}`);
ctx.shaders["shader_refraction"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 refracted_vector = refract(incident_vector, normal, ior);

    frag_color = vec4(refracted_vector, 1);
}`);
ctx.shaders["shader_reflection"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform vec2 cursor_pos;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 reflected_vector = reflect(incident_vector, normal);

    frag_color = vec4(reflected_vector, 1);
}`);
ctx.shaders["shader_reflection_tex"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform sampler2D bg;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 uv_bg = uv;
    uv_bg += vec2(1.0, 0.5);
    uv_bg *= 0.5;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 reflected_vector = reflect(incident_vector, normal);
    float reflected_corner = abs(reflected_vector.x - reflected_vector.y);
    float reflected_color = max(0.0001, abs(reflected_corner));

    frag_color = vec4(texture(bg, uv_bg).rgb+vec3(reflected_color), 1.0);
}`);
ctx.shaders["shader_refraction_reflection_tex"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform sampler2D bg;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 uv_bg = uv;
    uv_bg += vec2(1.0, 0.5);
    uv_bg *= 0.5;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 refracted_vector = refract(incident_vector, normal, ior);

    vec3 reflected_vector = reflect(incident_vector, normal);
    float reflected_corner = abs(reflected_vector.x - reflected_vector.y);
    float reflected_color = max(0.0001, abs(reflected_corner));

    vec3 refracted_color = texture(bg, uv_bg+refracted_vector.xy).rgb;

    frag_color = vec4(refracted_color + reflected_color, 1.0);
}`);
ctx.shaders["shader_chromatic_aberration"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform sampler2D bg;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;
uniform float u_offset_r;
uniform float u_offset_b;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 uv_bg = uv;
    uv_bg += vec2(1.0, 0.5);
    uv_bg *= 0.5;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 refracted_vector = refract(incident_vector, normal, ior);

    vec3 reflected_vector = reflect(incident_vector, normal);
    float reflected_corner = abs(reflected_vector.x - reflected_vector.y);
    float reflected_color = max(0.0001, abs(reflected_corner));

    vec3 refracted_color = vec3(
        texture(bg, uv_bg + refracted_vector.xy * u_offset_r).r,
        texture(bg, uv_bg + refracted_vector.xy).g,
        texture(bg, uv_bg + refracted_vector.xy * u_offset_b).b
    );

    frag_color = vec4(refracted_color, 1.0);
}`);
ctx.shaders["shader_sdf_mix"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform sampler2D bg;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

// https://iquilezles.org/articles/smin/
float smooth_union( float d1, float d2, float k )
{
    float h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
    return mix( d2, d1, h ) - k*h*(1.0-h);
}

float sdf_circle(vec2 p, vec2 center, float radius){
    return length(p - center) - radius;
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 uv_bg = uv;
    uv_bg += vec2(1.0, 0.5);
    uv_bg *= 0.5;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    sdf = smooth_union(sdf, sdf_circle(uv, vec2(-0.3, 0.2), 0.2)*u_sdf_multiplier, 20.0);

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 refracted_vector = refract(incident_vector, normal, ior);

    vec3 reflected_vector = reflect(incident_vector, normal);
    float reflected_corner = abs(reflected_vector.x - reflected_vector.y);
    float reflected_color = max(0.0001, abs(reflected_corner));

    vec3 refracted_color = texture(bg, uv_bg+refracted_vector.xy).rgb;

    frag_color = vec4(refracted_color + reflected_color, 1.0);
}`);
ctx.shaders["shader_refraction_tex"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec2 texcoord_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec2 texcoord;

void main(){
    gl_Position = vec4(position_attrib, 1.0);
    position = position_attrib;
    texcoord = texcoord_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec2 resolution;
uniform float u_sdf_multiplier;
uniform vec2 scene_offset;
uniform sampler2D bg;
uniform vec2 cursor_pos;
uniform float u_ior;
uniform float u_thickness;
uniform float u_radius;

out vec4 frag_color;

in vec3 position;
in vec2 texcoord;

float sdf_rounded_rect(vec2 center, vec2 size, vec2 p, float r)
{
    vec2 p_rel = p - center;
    vec2 q = abs(p_rel) - size;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 get_normal(float sdf, float thickness)
{
    float normal_cos = max(thickness + sdf, 0.0) / thickness;
    float normal_sin = sqrt(1.0 - normal_cos * normal_cos);

    return normalize(vec3(dFdx(sdf) * normal_cos, dFdy(sdf) * normal_cos, normal_sin));
}

void main(){
    vec2 frag_coord_scene = gl_FragCoord.xy - scene_offset;
    vec2 uv = frag_coord_scene / resolution;
    uv = uv - 0.5;
    uv.x *= resolution.x / resolution.y;

    vec2 uv_bg = uv;
    uv_bg += vec2(1.0, 0.5);
    uv_bg *= 0.5;

    vec2 pos = (cursor_pos*vec2(1, -1)) + vec2(-0.5, 0.5);

    float sdf = sdf_rounded_rect(pos, vec2(0.1, 0.1), uv, u_radius)*u_sdf_multiplier;

    vec3 normal = get_normal(sdf, u_thickness);

    float ior = 1.0/u_ior;
    vec3 incident_vector = vec3(0.0, 0.0, -1.0);

    vec3 refracted_vector = refract(incident_vector, normal, ior);

    frag_color = vec4(texture(bg, uv_bg+refracted_vector.xy).rgb, 1);
}`);
ctx.shaders["shader_basic"] = ctx.create_shader(`#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
}`,
`#version 300 es
precision highp float;

uniform vec3 color;
uniform sampler2D texture_uniform;

out vec4 frag_color;

in vec3 position;
in vec3 normal;

void main(){
    frag_color = vec4(color, 1);
}`);

function get_event_coordinates(e, element) {
    const rect = element.getBoundingClientRect();
    const is_touch = e.touches ? true : false;
    const client_x = is_touch ? e.touches[0].clientX : e.clientX;
    const client_y = is_touch ? e.touches[0].clientY : e.clientY;

    return {
        x: client_x - rect.left,
        y: client_y - rect.top
    };
}

function handle_interaction_end(e) {
    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.dragging_rect = null;
        scene.is_dragging = false;
        scene.last_pos = null;
    }
}

function setup_scene_listeners(){
    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.el = document.getElementById(scene_id);

        (function(scene_id, scene) {
            function handle_move(e) {
                if (e.touches) e.preventDefault();

                const coords = get_event_coordinates(e, scene.el);
                let hovered = false;

                for (let rect_id in scene.draggable_rects) {
                    const rect = scene.draggable_rects[rect_id];
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        hovered = true;
                        break;
                    }
                }
                scene.el.style.cursor = hovered ? "move" : "default";
            }

            function handle_start(e) {
                e.preventDefault();
                if (!e.touches && e.which !== 1) return;

                const coords = get_event_coordinates(e, scene.el);

                for (let rect_id in scene.draggable_rects) {
                    const rect = scene.draggable_rects[rect_id];
                    if (rect_id == "scene" || coords.x >= rect[0] && coords.x <= rect[2] &&
                        coords.y >= rect[1] && coords.y <= rect[3]) {
                        scene.dragging_rect = rect_id;
                        scene.is_dragging = true;
                        scene.last_pos = [coords.x, coords.y];
                        break;
                    }
                }
            }

            scene.el.removeEventListener("mousemove", scene.event_listener_mousemove);
            scene.el.removeEventListener("touchmove", scene.event_listener_touchmove);
            scene.el.removeEventListener("mousedown", scene.event_listener_mousedown);
            scene.el.removeEventListener("touchstart", scene.event_listener_touchstart);
            scene.event_listener_mousemove = scene.el.addEventListener("mousemove", handle_move);
            scene.event_listener_touchmove = scene.el.addEventListener("touchmove", handle_move);
            scene.event_listener_mousedown = scene.el.addEventListener("mousedown", handle_start);
            scene.event_listener_touchstart = scene.el.addEventListener("touchstart", handle_start);
        })(scene_id, scene);
    }
}

function handle_global_move(e) {
    if (e.touches) e.preventDefault();

    for(let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        if (!scene.is_dragging || !scene.last_pos) continue;

        const coords = get_event_coordinates(e, scene.el);
        let current_pos = [coords.x/scene.width, coords.y/scene.height];
        scene.cursor_pos = current_pos;
    }
}

document.addEventListener("mousemove", handle_global_move);
document.addEventListener("touchmove", handle_global_move);
document.addEventListener("mouseup", handle_interaction_end);
document.addEventListener("touchend", handle_interaction_end);
setup_scene_listeners();


ctx.draw = function(drawable, custom_uniforms, custom_camera, custom_shader){
    if(drawable == null) return;
    if(drawable.vertex_buffer == null) return;
    const gl = this.gl;
    const shader = custom_shader ? ctx.shaders[custom_shader] : ctx.shaders[drawable.shader];

    if(this.previous_shader != drawable.shader || this.previous_scene != this.current_scene || ctx.current_scene.camera_dirty){
        gl.useProgram(shader.program);
        const scene = ctx.current_scene;

        if(custom_camera){
            update_camera_projection_matrix(custom_camera, scene.width/scene.height);
            ctx.set_shader_uniform(shader, "p", custom_camera.projection_matrix);
            ctx.set_shader_uniform(shader, "v", custom_camera.view_matrix);
        }
        else{
            update_camera_projection_matrix(scene.camera, scene.width/scene.height);
            ctx.set_shader_uniform(shader, "p", scene.camera.projection_matrix);
            ctx.set_shader_uniform(shader, "v", scene.camera.view_matrix);
        }
        this.previous_shader = drawable.shader;
        this.previous_scene = this.current_scene;
        this.current_scene.camera_dirty = true;
    }

    ctx.set_shader_uniform(shader, "time", this.time);
    gl.bindVertexArray(drawable.vertex_buffer.vao);
    this.set_shader_uniform(this.shaders[drawable.shader], "color", drawable.color);
    this.set_shader_uniform(this.shaders[drawable.shader], "m", drawable.transform);
    if(custom_uniforms){
        for(let custom_uniform in custom_uniforms){
            ctx.set_shader_uniform(shader, custom_uniform, custom_uniforms[custom_uniform]);
        }
    }

    gl.drawElements(gl.TRIANGLES, drawable.vertex_buffer.draw_count, gl.UNSIGNED_SHORT, 0);
}

ctx.create_drawable = function(shader, mesh, color, transform, custom_vertex_attribs){
    let drawable = {
        shader: shader,
        vertex_buffer : mesh == null ? null : this.create_vertex_buffer(mesh.vertices, custom_vertex_attribs == null ? [
                            { name: 'position_attrib', size: 3 },
                            { name: 'normal_attrib', size: 3 }
                        ] : custom_vertex_attribs, mesh.indices),
        color: color,
        transform: transform
    };
    this.drawables.push(drawable);
    return drawable;
}

function resize_event(ctx){
    ctx.gl.canvas.width = window.innerWidth;
    ctx.gl.canvas.height = window.innerHeight;

    let width = document.body.clientWidth - parseInt(window.getComputedStyle(document.body).paddingLeft) - parseInt(window.getComputedStyle(document.body).paddingRight);

    for (let scene_id in ctx.scenes) {
        const scene = ctx.scenes[scene_id];
        scene.el = document.getElementById(scene_id);
        let height = width/scene.ratio;
        scene.el.style.width = width + "px";
        scene.el.style.height = height + "px";
        scene.width = width;
        scene.height = height;
    }
    setup_scene_listeners();

}
resize_event(ctx);
addEventListener("resize", () => resize_event(ctx));

ctx.texture_bg = ctx.gl.createTexture();

let fullscreen_quad = ctx.create_drawable("shader_shape", {
    vertices: [
        -1, -1, 0, 0, 0,
         1, -1, 0, 1, 0,
         1,  1, 0, 1, 1,
        -1,  1, 0, 0, 1
    ],
    indices: [
        0, 1, 2,
        0, 2, 3
    ]
}, [1, 0, 1], mat4_identity(), [
    { name: "position_attrib", size: 3 },
    { name: "texcoord_attrib", size: 2 }
]);

ctx.time = 0.0;
ctx.last_time = 0.0;

//scene_snells

function create_rect(start_position, size) {
    let [x, y, z] = start_position;
    let [width, height] = size;

    let vertices = [
        x, y, z, 0, 0, 0,
        x + width, y, z, 0, 1, 0,
        x + width, y + height, z, 0, 1, 1,
        x, y + height, z, 0, 0, 1,
    ];

    let indices = [
        0, 1, 2,
        0, 2, 3
    ];

    return { vertices: vertices, indices: indices };
}

function create_line_dashed(points, thickness, dash_length = 0.1, gap_length = 0.1, use_miter = true) {
    let dashed_points = [];

    for (let i = 1; i < points.length; i++) {
        let p1 = points[i - 1];
        let p2 = points[i];
        let dx = p2[0] - p1[0];
        let dy = p2[1] - p1[1];
        let segment_length = Math.sqrt(dx * dx + dy * dy);
        let dir = [dx / segment_length, dy / segment_length];
        let distance = 0;

        while (distance + dash_length <= segment_length) {
            let dash_start = [
                p1[0] + dir[0] * distance,
                p1[1] + dir[1] * distance
            ];
            dashed_points.push(dash_start);

            let dash_end = [
                p1[0] + dir[0] * (distance + dash_length),
                p1[1] + dir[1] * (distance + dash_length)
            ];
            dashed_points.push(dash_end);

            distance += dash_length + gap_length;
        }

        if (distance < segment_length && segment_length - distance > 0.01) {
            let remaining = segment_length - distance;
            if (remaining <= dash_length) {
                dashed_points.push([
                    p1[0] + dir[0] * distance,
                    p1[1] + dir[1] * distance
                ]);
                dashed_points.push([
                    p1[0] + dir[0] * segment_length,
                    p1[1] + dir[1] * segment_length
                ]);
            }
        }
    }

    let all_vertices = [];
    let all_indices = [];
    let vertex_offset = 0;

    for (let i = 0; i < dashed_points.length; i += 2) {
        if (i + 1 < dashed_points.length) {
            let dash = [dashed_points[i], dashed_points[i + 1]];
            let line = create_line(dash, thickness, use_miter);
            all_vertices.push(...line.vertices);

            for (let j = 0; j < line.indices.length; j++) {
                all_indices.push(line.indices[j] + vertex_offset);
            }

            vertex_offset += line.vertices.length / 6;
        }
    }

    return { vertices: all_vertices, indices: all_indices };
}

function create_line(points, thickness, use_miter = true) {
    thickness /= 2;
    let vertices = [];
    let indices = [];
    let vertex_count = 0;

    if (points.length >= 2) {
        let p1 = points[0];
        let p2 = points[1];
        let dir = vec2_normalize(vec2_sub(p2, p1));
        let normal = [-dir[1], dir[0]];

        vertices.push(
            p1[0] + normal[0] * thickness, p1[1] + normal[1] * thickness, 0, 0, 0, 1,
            p1[0] - normal[0] * thickness, p1[1] - normal[1] * thickness, 0, 0, 0, 1
        );
        vertex_count += 2;
    }

    for (let i = 1; i < points.length - 1; i++) {
        let prev = points[i - 1];
        let curr = points[i];
        let next = points[i + 1];

        let dir1 = vec2_normalize(vec2_sub(curr, prev));
        let dir2 = vec2_normalize(vec2_sub(next, curr));
        let normal1 = [-dir1[1], dir1[0]];
        let normal2 = [-dir2[1], dir2[0]];

        if (use_miter) {
            let tangent = vec2_normalize(vec2_add(dir1, dir2));
            let miter = [-tangent[1], tangent[0]];
            let dot = normal1[0] * normal2[0] + normal1[1] * normal2[1];
            let miter_length = thickness / Math.sqrt((1 + dot) / 2);

            vertices.push(
                curr[0] + miter[0] * miter_length, curr[1] + miter[1] * miter_length, 0, 0, 0, 1,
                curr[0] - miter[0] * miter_length, curr[1] - miter[1] * miter_length, 0, 0, 0, 1
            );

            indices.push(
                vertex_count - 2, vertex_count - 1, vertex_count,
                vertex_count - 1, vertex_count + 1, vertex_count
            );

            vertex_count += 2;
        } else {
            vertices.push(
                curr[0] + normal1[0] * thickness, curr[1] + normal1[1] * thickness, 0, 0, 0, 1,
                curr[0] - normal1[0] * thickness, curr[1] - normal1[1] * thickness, 0, 0, 0, 1,
                curr[0] + normal2[0] * thickness, curr[1] + normal2[1] * thickness, 0, 0, 0, 1,
                curr[0] - normal2[0] * thickness, curr[1] - normal2[1] * thickness, 0, 0, 0, 1
            );

            indices.push(
                vertex_count - 2, vertex_count - 1, vertex_count,
                vertex_count - 1, vertex_count + 1, vertex_count,
                vertex_count, vertex_count + 1, vertex_count + 2,
                vertex_count + 1, vertex_count + 3, vertex_count + 2
            );

            vertex_count += 4;
        }
    }

    if (points.length >= 2) {
        let p1 = points[points.length - 2];
        let p2 = points[points.length - 1];
        let dir = vec2_normalize(vec2_sub(p2, p1));
        let normal = [-dir[1], dir[0]];

        vertices.push(
            p2[0] + normal[0] * thickness, p2[1] + normal[1] * thickness, 0, 0, 0, 1,
            p2[0] - normal[0] * thickness, p2[1] - normal[1] * thickness, 0, 0, 0, 1
        );

        indices.push(
            vertex_count - 2, vertex_count - 1, vertex_count,
            vertex_count - 1, vertex_count + 1, vertex_count
        );

        vertex_count += 2;
    }

    return {vertices: vertices, indices: indices};
}


function create_arrow(from, to, size) {
    let [x1, y1, z1] = from;
    let [x2, y2, z2] = to;
    let [body_width, head_size] = size;
    let dx = x2 - x1;
    let dy = y2 - y1;
    let length = Math.sqrt(dx * dx + dy * dy);
    let dir_x = dx / length;
    let dir_y = dy / length;
    let perp_x = -dir_y;
    let perp_y = dir_x;
    let body_half_width = body_width / 2;
    let body_end_x = x2 - dir_x * head_size;
    let body_end_y = y2 - dir_y * head_size;
    let vertices = [
        x1 + perp_x * body_half_width, y1 + perp_y * body_half_width, z1, 0, 0, 0,
        x1 - perp_x * body_half_width, y1 - perp_y * body_half_width, z1, 0, 1, 0,
        body_end_x - perp_x * body_half_width, body_end_y - perp_y * body_half_width, z1, 0, 1, 1,
        body_end_x + perp_x * body_half_width, body_end_y + perp_y * body_half_width, z1, 0, 0, 1,
        x2, y2, z1, 0.5, 0.5, 0,
        body_end_x + perp_x * head_size, body_end_y + perp_y * head_size, z1, 0, 0, 0,
        body_end_x - perp_x * head_size, body_end_y - perp_y * head_size, z1, 0, 1, 0,
    ];
    let indices = [
        0, 1, 2,
        0, 2, 3,
        4, 5, 6,
    ];
    return { vertices: vertices, indices: indices };
}


function remap_value(value, from_min, from_max, to_min, to_max) {
    const normalized = (value - from_min) / (from_max - from_min)
    return to_min + (normalized * (to_max - to_min))
}

let medium_width = 2;
let medium_height = 1;
let fresnel_medium_1 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.8, 0.9, 1], translate_3d([-medium_width/2, -medium_height, 0]));
let fresnel_medium_2 = ctx.create_drawable("shader_basic",
    create_rect([0, 0, 0], [medium_width, medium_height]),
    [0.960, 0.980, 1.000], translate_3d([-medium_width/2, 0, 0]));

let fresnel_incidence_angle = -30;
let fresnel_snells_len = 0.8;
let fresnel_snells_len_curve = 0.7;
let fresnel_ior_1 = 1.5;
let fresnel_ior_2 = 1;

let normal_line = ctx.create_drawable("shader_basic", create_line_dashed([[0, -1, 0], [0, 1, 0]], 0.01, 0.03, 0.015), [0.4, 0.4, 0.4], translate_3d([0, 0, 0]));
let medium_boundary = ctx.create_drawable("shader_basic", create_line([[-medium_width/2, 0, 0], [medium_width/2, 0, 0]], 0.02), [0.787, 0.860, 0.932], translate_3d([0, 0, 0]));

let fresnel_incident_ray_1 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, 0, 0]));
let fresnel_incident_ray_2 = ctx.create_drawable("shader_basic", null, [1, 0, 0], translate_3d([0, 0, 0]));
let fresnel_refracted_ray_1 = ctx.create_drawable("shader_basic", null, [0, 0.6, 1], translate_3d([0, 0, 0]));
let fresnel_refracted_ray_2 = ctx.create_drawable("shader_basic", null, [0, 0.6, 1], translate_3d([0, 0, 0]));
let fresnel_reflected_ray_1 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, 0, 0]));
let fresnel_reflected_ray_2 = ctx.create_drawable("shader_basic", null, [0.8, 0.8, 0], translate_3d([0, 0, 0]));

let fresnel_angle_1_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));
let fresnel_angle_2_curve = ctx.create_drawable("shader_basic", null, [0, 0, 0], translate_3d([0, 0, 0]));

function fresnel_coefficients(ior1, ior2, angle_rad) {
    let cos_i = Math.cos(angle_rad);
    let sin_t = (ior1 / ior2) * Math.sin(angle_rad);

    if (Math.abs(sin_t) > 1) return { R: 1, T: 0 };

    let cos_t = Math.sqrt(1 - sin_t * sin_t);

    let rs = ((ior1 * cos_i - ior2 * cos_t) / (ior1 * cos_i + ior2 * cos_t)) ** 2;
    let rp = ((ior1 * cos_t - ior2 * cos_i) / (ior1 * cos_t + ior2 * cos_i)) ** 2;

    let R = 0.5 * (rs + rp);
    let T = 1 - R;

    return { R, T };
}

function update_fresnel_scene() {
    let inc_angle_rad = rad(fresnel_incidence_angle);
    let { R, T } = fresnel_coefficients(fresnel_ior_2, fresnel_ior_1, Math.abs(inc_angle_rad));

    let medium1_color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(fresnel_ior_1, 1, 2.5, 0, 1));
    let medium2_color = vec3_lerp([1, 1, 1], [0.8, 0.9, 1], remap_value(fresnel_ior_2, 1, 2.5, 0, 1));

    let red = [1, 0, 0];
    let red_reflected = vec3_lerp(medium2_color, red, R);
    let red_refracted = vec3_lerp(medium1_color, red, T);

    let inc_dir = vec3_normalize([Math.sin(inc_angle_rad), Math.cos(inc_angle_rad), 0]);
    let inc_start = vec3_scale(inc_dir, fresnel_snells_len);
    let inc_mid_1 = vec3_scale(inc_dir, fresnel_snells_len / 2 - 0.01);
    let inc_mid = vec3_scale(inc_dir, fresnel_snells_len / 2);
    ctx.update_drawable_mesh(fresnel_incident_ray_1, create_arrow(inc_start, inc_mid_1, [0.017, 0.05]));
    ctx.update_drawable_mesh(fresnel_incident_ray_2, create_line([inc_mid, [0, 0, 0]], 0.017));
    fresnel_incident_ray_1.color = red;
    fresnel_incident_ray_2.color = red;

    let refraction_angle = Math.asin((fresnel_ior_2 / fresnel_ior_1) * Math.sin(inc_angle_rad)) + Math.PI;
    let refr_dir = vec3_normalize([Math.sin(refraction_angle), Math.cos(refraction_angle), 0]);
    let refr_mid_1 = vec3_scale(refr_dir, fresnel_snells_len / 2 + 0.01);
    let refr_mid = vec3_scale(refr_dir, fresnel_snells_len / 2);
    let refr_end = vec3_scale(refr_dir, fresnel_snells_len);
    ctx.update_drawable_mesh(fresnel_refracted_ray_1, create_arrow([0, 0, 0], refr_mid_1, [0.017, 0.05]));
    ctx.update_drawable_mesh(fresnel_refracted_ray_2, create_line([refr_mid, refr_end], 0.017));
    fresnel_refracted_ray_1.color = red_refracted;
    fresnel_refracted_ray_2.color = red_refracted;

    let reflection_angle = -inc_angle_rad;
    let refl_dir = vec3_normalize([Math.sin(reflection_angle), Math.cos(reflection_angle), 0]);
    let refl_mid_1 = vec3_scale(refl_dir, fresnel_snells_len / 2 + 0.01);
    let refl_mid = vec3_scale(refl_dir, fresnel_snells_len / 2);
    let refl_end = vec3_scale(refl_dir, fresnel_snells_len);
    ctx.update_drawable_mesh(fresnel_reflected_ray_1, create_arrow([0, 0, 0], refl_mid_1, [0.017, 0.05]));
    ctx.update_drawable_mesh(fresnel_reflected_ray_2, create_line([refl_mid, refl_end], 0.017));
    fresnel_reflected_ray_1.color = red_reflected;
    fresnel_reflected_ray_2.color = red_reflected;

    fresnel_medium_1.color = medium1_color;
    fresnel_medium_2.color = medium2_color;

    let curve_n = 10;
    let points_angle_1_curve = [];
    let angle_1 = fresnel_incidence_angle / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        points_angle_1_curve.push(vec3_scale([Math.sin(rad(angle_1 * i)), Math.cos(rad(angle_1 * i)), 0], fresnel_snells_len_curve));
    }
    ctx.update_drawable_mesh(fresnel_angle_1_curve, create_line(points_angle_1_curve, 0.01));

    let points_angle_2_curve = [];
    let angle_2 = (refraction_angle - Math.PI) / curve_n;
    for (let i = 0; i <= curve_n; i++) {
        let angle = refraction_angle - angle_2 * i;
        points_angle_2_curve.push(vec3_scale([Math.sin(angle), Math.cos(angle), 0], fresnel_snells_len_curve));
    }
    ctx.update_drawable_mesh(fresnel_angle_2_curve, create_line(points_angle_2_curve, 0.01));
}

update_fresnel_scene();

document.getElementById("fresnel-angle-input").value = fresnel_incidence_angle;
document.getElementById("fresnel-angle-input").addEventListener("input", function(e){
    fresnel_incidence_angle = parseFloat(e.target.value);
    update_fresnel_scene();
});
document.getElementById("fresnel-ior1-input").value = fresnel_ior_1;
document.getElementById("fresnel-ior1-input").addEventListener("input", function(e){
    fresnel_ior_1 = parseFloat(e.target.value);
    update_fresnel_scene();
});
document.getElementById("fresnel-ior2-input").value = fresnel_ior_2;
document.getElementById("fresnel-ior2-input").addEventListener("input", function(e){
    fresnel_ior_2 = parseFloat(e.target.value);
    update_fresnel_scene();
});
function update_camera_orbit(camera){
    let m = mat4_identity();
        m = mat4_mat4_mul(translate_3d(camera.orbit.pivot), m);
        m = mat4_mat4_mul(rotate_3d(euler_to_quat(camera.orbit.rotation)), m);
        m = mat4_mat4_mul(translate_3d([0, 0, camera.orbit.zoom]), m);
    camera.position = vec4_mat4_mul([0, 0, 0, 1], m).slice(0, 3);
    camera.view_matrix = mat4_invert(m);
}
// scene_snells

let ior = 1.5;
let thickness = 13.0;
let radius = 0.13;
let offset_r = 1.2;
let offset_b = 0.9;
let sdf_multiplier = 200;

function update(current_time){
    let delta_time = (current_time - ctx.last_time) / 1000;
    delta_time = Math.min(delta_time, 0.1);

    ctx.time += 0.01;

    const gl = ctx.gl;
    gl.canvas.style.transform = "translateY("+window.scrollY+"px)";
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for(let scene_id in ctx.scenes){
        const scene = ctx.scenes[scene_id];
        ctx.current_scene = scene;
        const rect = scene.el.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top  > gl.canvas.clientHeight ||
            rect.right  < 0 || rect.left > gl.canvas.clientWidth) {
            continue;
        }

        const width  = rect.width;
        const height = rect.height;
        const left   = rect.left - gl.canvas.getBoundingClientRect().left;
        const bottom = gl.canvas.clientHeight - (rect.bottom - gl.canvas.getBoundingClientRect().top);

        gl.viewport(left, bottom, width, height);
        gl.scissor(left, bottom, width, height);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        if(scene_id == "scene_shape"){
            fullscreen_quad.shader = "shader_shape";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_normal"){
            fullscreen_quad.shader = "shader_normal";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_refraction"){
            fullscreen_quad.shader = "shader_refraction";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_refraction_tex"){
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, ctx.texture_bg);
            fullscreen_quad.shader = "shader_refraction_tex";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_reflection"){
            fullscreen_quad.shader = "shader_reflection";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_reflection_tex"){
            fullscreen_quad.shader = "shader_reflection_tex";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_refraction_reflection_tex"){
            fullscreen_quad.shader = "shader_refraction_reflection_tex";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_chromatic_aberration"){
            fullscreen_quad.shader = "shader_chromatic_aberration";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_offset_r": offset_r,
                "u_offset_b": offset_b,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
        else if(scene_id == "scene_snells"){
            update_camera_orbit(scene.camera);
            ctx.draw(fresnel_incident_ray_1);
            ctx.draw(fresnel_incident_ray_2);
            ctx.draw(fresnel_refracted_ray_1);
            ctx.draw(fresnel_refracted_ray_2);
            ctx.draw(fresnel_reflected_ray_1);
            ctx.draw(fresnel_reflected_ray_2);
            ctx.draw(fresnel_angle_1_curve);
            ctx.draw(fresnel_angle_2_curve);
            ctx.draw(normal_line);
            ctx.draw(medium_boundary);
            ctx.draw(fresnel_medium_1);
            ctx.draw(fresnel_medium_2);
        }
        else if(scene_id == "scene_sdf_mix"){
            fullscreen_quad.shader = "shader_sdf_mix";
            ctx.draw(fullscreen_quad, {"cursor_pos": [scene.cursor_pos[0], scene.cursor_pos[1]], "scene_offset": [left, bottom], "resolution": [width, height],
                "u_ior": ior,
                "u_thickness": thickness,
                "u_radius": radius,
                "u_sdf_multiplier": sdf_multiplier,
            });
        }
    }

    requestAnimationFrame(update);
}
requestAnimationFrame(update);


async function get_texture(){
    const image = new Image();
    image.src = "bg.jpg";

    await new Promise((resolve, reject) => {
        image.onload = () => {
            ctx.gl.bindTexture(ctx.gl.TEXTURE_2D, ctx.texture_bg);
            ctx.gl.texImage2D(ctx.gl.TEXTURE_2D, 0, ctx.gl.RGBA, ctx.gl.RGBA, ctx.gl.UNSIGNED_BYTE, image);
            ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_MIN_FILTER, ctx.gl.LINEAR_MIPMAP_LINEAR);
            ctx.gl.texParameteri(ctx.gl.TEXTURE_2D, ctx.gl.TEXTURE_MAG_FILTER, ctx.gl.LINEAR);
            ctx.gl.generateMipmap(ctx.gl.TEXTURE_2D);
        };
        image.onerror = reject;
    });
}

get_texture();

document.getElementById("radius-input").value = radius;
document.getElementById("radius-value").innerHTML = radius;
document.getElementById("radius-input").addEventListener("input", (e) => {
    radius = parseFloat(e.target.value);
    document.getElementById("radius-value").innerHTML = radius;
});

document.getElementById("ior-input").value = ior;
document.getElementById("ior-value").innerHTML = ior;
document.getElementById("ior-input").addEventListener("input", (e) => {
    ior = parseFloat(e.target.value);
    document.getElementById("ior-value").innerHTML = ior;
});

document.getElementById("thickness-input").value = thickness;
document.getElementById("thickness-value").innerHTML = thickness;
document.getElementById("thickness-input").addEventListener("input", (e) => {
    thickness = parseFloat(e.target.value);
    document.getElementById("thickness-value").innerHTML = thickness;
});

document.getElementById("offset-r-input").value = offset_r;
document.getElementById("offset-r-value").innerHTML = offset_r;
document.getElementById("offset-r-input").addEventListener("input", (e) => {
    offset_r = parseFloat(e.target.value);
    document.getElementById("offset-r-value").innerHTML = offset_r;
});

document.getElementById("offset-b-input").value = offset_b;
document.getElementById("offset-b-value").innerHTML = offset_b;
document.getElementById("offset-b-input").addEventListener("input", (e) => {
    offset_b = parseFloat(e.target.value);
    document.getElementById("offset-b-value").innerHTML = offset_b;
});


document.getElementById("sdf-multiplier-input").value = sdf_multiplier;
document.getElementById("sdf-multiplier-value").innerHTML = sdf_multiplier;
document.getElementById("sdf-multiplier-input").addEventListener("input", (e) => {
    sdf_multiplier = parseFloat(e.target.value);
    document.getElementById("sdf-multiplier-value").innerHTML = sdf_multiplier;
});


const sliders = document.querySelectorAll("input[type='range']");

function update_slider_background(slider) {
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const value = parseFloat(slider.value);
    const percentage = ((value - min) / (max - min)) * 100;
    const color = slider.getAttribute("data-color") || "#555";

    slider.style.background = `linear-gradient(to right, ${color} ${percentage}%, #ddd ${percentage}%)`;
    slider.style.setProperty("--thumb-color", color);
}

sliders.forEach(slider => {
    update_slider_background(slider);
    slider.addEventListener("input", () => update_slider_background(slider));
});

const div = document.getElementById("sliders");
const trigger_point = div.offsetTop;
window.addEventListener("scroll", () => {
    if (window.scrollY >= trigger_point) {
        div.classList.add("fixed");
    } else {
        div.classList.remove("fixed");
    }
});