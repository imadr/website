let gl_canvas = document.createElement("canvas");
let gl = gl_canvas.getContext("webgl2");

let shader = create_shader(gl, `#version 300 es
layout(location = 0) in vec3 position_attrib;
layout(location = 1) in vec3 normal_attrib;

uniform mat4 m;
uniform mat4 v;
uniform mat4 p;

out vec3 position;
out vec3 normal;
out mat4 m_inv;

void main(){
    gl_Position = p*v*m*vec4(position_attrib, 1);
    position = position_attrib;
    normal = normal_attrib;
    m_inv = inverse(m);
}`,
`#version 300 es
precision highp float;

uniform vec3 light_position;

out vec4 frag_color;

in vec3 position;
in vec3 normal;
in mat4 m_inv;

void main(){
    float ambient = 0.1f;
    vec3 light_position_ = (m_inv*vec4(light_position, 1.0)).xyz;
    float diffuse = max(0.0f, dot(normal, light_position_))*0.4;
    float light = diffuse+ambient;
    vec3 col = vec3(light);
    col = pow(col, vec3(1.0/2.2));
    frag_color = vec4(col, 1);
}`);

let mesh_buffer = create_vertex_buffer(gl, teapot.buffer, teapot.attributes, true, teapot.indices);

let start = euler_to_quat([0, -Math.PI-Math.PI/2, 0]);
let end = euler_to_quat([0, 0, 0]);

let scene = [
    {
        name: "mesh",
        mesh: mesh_buffer,
        shader: shader,
        transform: {
            position: [0, 0, 0],
            scale: [0.7, 0.7, 0.7],
            rotation: start
        },
        transparent: false
    },
];

let main_camera = {
    fov: 30, z_near: 0.1, z_far: 1000,
    position: [0, 1, 8], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {
        rotation: [0, 0, 0],
        pivot: [0, 1, 0],
        zoom: 5
    }
};

update_camera_projection_matrix(gl, main_camera);
update_camera_view_matrix(gl, main_camera);

let ctxs = [];
let canvas_id = ["mult", "lerp", "lerp-fixed"];

for(let i = 0; i < canvas_id.length; i++){
    let canvas = document.getElementById("canvas-"+canvas_id[i]);
    canvas.width = 530;
    canvas.height = 280;
    ctxs.push(canvas.getContext("2d"));
}
gl_canvas.width = 530;
gl_canvas.height = 280;

function resize_canvas(){
    let padding = parseFloat(window.getComputedStyle(document.body).getPropertyValue("padding-left"))
    let width = parseFloat(window.getComputedStyle(document.body).width);
    width -= padding*2;
    width = Math.min(530, width);
    gl_canvas.width = width;
    update_camera_projection_matrix(gl, main_camera);
    for(let i = 0; i < ctxs.length; i++){
        ctxs[i].canvas.width = width;
        update(i);
    }
}

function update(id){
    gl.viewport(0, 0, gl_canvas.width, gl_canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    set_shader_uniform(gl, scene[0].shader, "light_position", [1, 0, 1]);

    for(let i = 0; i < scene.length; i++){
        draw(gl, scene[i].mesh, scene[i].shader, scene[i].transform, main_camera);
    }

    ctxs[id].clearRect(0, 0, gl_canvas.width, gl_canvas.height);
    ctxs[id].drawImage(gl_canvas, 0, 0);
}

window.addEventListener("resize", resize_canvas);
resize_canvas();

let demo_lerp_interval = null;
let demo_lerp_playing = false;
document.getElementById("slerp-slider-lerp").oninput = function(){
    demo_lerp_playing = false;
    clearInterval(demo_lerp_interval);
    scene[0].transform.rotation = bad_quat_slerp(start, end, parseFloat(this.value));
    document.getElementById("t-value-lerp").innerHTML = (Math.round(parseFloat(this.value)*100)/100).toFixed(2)
    update(1);
}
document.getElementById("play-demo-lerp").onclick = function(){
    demo_lerp_playing = !demo_lerp_playing;
    this.innerHTML = demo_lerp_playing ? "Reset" : "Play";
    let slider = document.getElementById("slerp-slider-lerp");
    let t_value = document.getElementById("t-value-lerp");
    slider.value = 0;
    if(demo_lerp_playing){
        demo_lerp_interval = setInterval(function(){
            if(parseFloat(slider.value) >= 1){
                clearInterval(demo_lerp_interval);
                play = false;
            }
            slider.value = parseFloat(slider.value)+0.002;
            scene[0].transform.rotation = bad_quat_slerp(start, end, parseFloat(slider.value));
            t_value.innerHTML = (Math.round(parseFloat(slider.value)*100)/100).toFixed(2);
            update(1);
        }, 1);
    }
    else{
        clearInterval(demo_lerp_interval);
        slider.value = 0;
        scene[0].transform.rotation = bad_quat_slerp(start, end, parseFloat(slider.value));
        t_value.innerHTML = (Math.round(parseFloat(slider.value)*100)/100).toFixed(2);
        update(1);
    }
};

let demo_lerp_fixed_interval = null;
let demo_lerp_fixed_playing = false;
document.getElementById("slerp-slider-lerp-fixed").oninput = function(){
    demo_lerp_fixed_playing = false;
    clearInterval(demo_lerp_fixed_interval);
    scene[0].transform.rotation = quat_slerp(start, end, parseFloat(this.value));
    document.getElementById("t-value-lerp-fixed").innerHTML = (Math.round(parseFloat(this.value)*100)/100).toFixed(2)
    update(2);
}
document.getElementById("play-demo-lerp-fixed").onclick = function(){
    demo_lerp_fixed_playing = !demo_lerp_fixed_playing;
    this.innerHTML = demo_lerp_fixed_playing ? "Reset" : "Play";
    let slider = document.getElementById("slerp-slider-lerp-fixed");
    let t_value = document.getElementById("t-value-lerp-fixed");
    slider.value = 0;
    if(demo_lerp_fixed_playing){
        demo_lerp_fixed_interval = setInterval(function(){
            if(parseFloat(slider.value) >= 1){
                clearInterval(demo_lerp_fixed_interval);
                play = false;
            }
            slider.value = parseFloat(slider.value)+0.002;
            scene[0].transform.rotation = quat_slerp(start, end, parseFloat(slider.value));
            t_value.innerHTML = (Math.round(parseFloat(slider.value)*100)/100).toFixed(2);
            update(2);
        }, 1);
    }
    else{
        clearInterval(demo_lerp_fixed_interval);
        slider.value = 0;
        scene[0].transform.rotation = quat_slerp(start, end, parseFloat(slider.value));
        t_value.innerHTML = (Math.round(parseFloat(slider.value)*100)/100).toFixed(2);
        update(2);
    }
};

// // quick and dirty
// function input_parse(id){
//     return eval(document.getElementById(id).value.replace("π", "Math.PI"));
// }

// function demo_mult(i){
//     let rot1 = euler_to_quat([input_parse("rot1-0"), input_parse("rot1-1"), input_parse("rot1-2")]);
//     let rot2 = euler_to_quat([input_parse("rot2-0"), input_parse("rot2-1"), input_parse("rot2-2")]);
//     objects_to_draw[i][0].transform.rotation = quat_mul(quat_mul(rot1, rot2), quat_id());
//     update();
// }

