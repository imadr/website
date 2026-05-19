let texture_size = 150;
let grid_size = [100, 100];

let noise_texture = [];
let normal_texture = [];

let canvas_noise_1 = document.getElementById("canvas_noise_1");
canvas_noise_1.width = texture_size;
canvas_noise_1.height = texture_size;
let ctx_noise_1 = canvas_noise_1.getContext("2d");

let canvas_noise_2 = document.getElementById("canvas_noise_2");
canvas_noise_2.width = texture_size;
canvas_noise_2.height = texture_size;
let ctx_noise_2 = canvas_noise_2.getContext("2d");

let canvas_normal = document.getElementById("canvas_gl_normal");
canvas_normal.width = texture_size;
canvas_normal.height = texture_size;
let ctx_normal = canvas_normal.getContext("2d");

let seed = Math.floor(Math.random()*10000)+"";
let octaves = 4;
let height_multiplier = 20;
let height_addend = 0;
let normal_strength = 8;
let seed_input = document.getElementById("seed");
let ocataves_input = document.getElementById("octaves");
let height_multiplier_input = document.getElementById("height_multiplier");
let height_addend_input = document.getElementById("height_addend");
let normal_strength_input = document.getElementById("normal_strength");
let rand = xmur3(seed);
let noise = get_noise_function(generate_permutation_table(rand));
seed_input.value = seed;
ocataves_input.value = octaves;
height_multiplier_input.value = height_multiplier;
height_addend_input.value = height_addend;
normal_strength_input.value = normal_strength;
seed_input.onchange = function(){ update(true); };
ocataves_input.onchange = function(){ update(true); };
height_multiplier_input.oninput = function(){ update(false); };
height_addend_input.oninput = function(){ update(false); };
normal_strength_input.oninput = function(){ update(true); };

let image_data1, image_data2, image_data3, data1, data2, data3;
let tile_size = 3;

function draw_texture(){
    let before_last;
    for(let x = 0; x < tile_size; x++){
        for(let y = 0; y < tile_size; y++){
            let noise_ = [];
            let index;
            for(let j = 0; j < texture_size; j++){
                for(let i = 0; i < texture_size; i++){
                    freq = 0.01;
                    amplitude = 1;
                    let col = noise((i+x*texture_size)*freq, (j+y*texture_size)*freq, 0)*amplitude;
                    col2 = Math.abs(col)*255;
                    index = (i*texture_size+j)*4;

                    data1[index] = col2;
                    data1[index+1] = col2;
                    data1[index+2] = col2;
                    data1[index+3] = 255;

                    for(let k = 0; k < octaves; k++){
                        freq *= 2;
                        amplitude /= 2;
                        col += noise((i+x*texture_size)*freq, (j+y*texture_size)*freq, 0)*amplitude;
                    }
                    noise_.push(Math.abs(col));
                    col = Math.abs(col)*255;

                    data2[index] = col;
                    data2[index+1] = col;
                    data2[index+2] = col;
                    data2[index+3] = 255;
                }
            }

            for(let j = 0; j < texture_size; j++){
                for(let i = 0; i < texture_size; i++){
                    let t = noise_[j*texture_size+i];
                    if(j > 0) t = noise_[((j-1)*texture_size+i)];
                    let tl = noise_[j*texture_size+i];
                    if(j > 0 && i > 0) tl = noise_[((j-1)*texture_size+(i-1))];
                    let tr = noise_[j*texture_size+i];
                    if(j > 0 && i < texture_size-1) tr = noise_[((j-1)*texture_size+(i+1))];
                    let b = noise_[j*texture_size+i];
                    if(j < texture_size-1) b = noise_[((j+1)*texture_size+i)];
                    let r = noise_[j*texture_size+i];
                    if(i < texture_size-1) r = noise_[(j*texture_size+(i+1))];
                    let l = noise_[j*texture_size+i];
                    if(i > 0) l = noise_[(j*texture_size+(i-1))];
                    let bl = noise_[j*texture_size+i];
                    if(j < texture_size-1 && i > 0) bl = noise_[((j+1)*texture_size+(i-1))];
                    let br = noise_[j*texture_size+i];
                    if(j < texture_size-1 && i < texture_size-1) br = noise_[((j+1)*texture_size+(i+1))];

                    let dx = (tr+2*r+br)-(tl+2*l+bl);
                    let dy = (bl+2*b+br)-(tl+2*t+tr);
                    let dz = 1/normal_strength;

                    let n = vec3_normalize([dx, dy, dz]);

                    n = vec3_add(vec3_scale(n, 0.5), [0.5, 0.5, 0.5]);
                    n = vec3_scale(n, 255);

                    index = (i*texture_size+j)*4;

                    data3[index] = n[0];
                    data3[index+1] = n[1];
                    data3[index+2] = n[2];
                    data3[index+3] = 255;
                }
            }

            ctx_noise_1.putImageData(image_data1, 0, 0);
            ctx_noise_2.putImageData(image_data2, 0, 0);
            ctx_normal.putImageData(image_data3, 0, 0);

            noise_texture[y*tile_size+x] = new ImageData(new Uint8ClampedArray(image_data2.data),
                                    texture_size, texture_size);
            normal_texture[y*tile_size+x] = new ImageData(new Uint8ClampedArray(image_data3.data),
                                    texture_size, texture_size);
        }
    }
}

let canvas_id = [
    "canvas_grid",
    "canvas_terrain",
    "canvas_color",
    "canvas_light",
    "canvas_water",
];
let canvas_count = canvas_id.length;
let canvas_s = [];
let gl_s = [];
let objects_to_draw_s = [];
let shaders_files = [];
for(let i = 0; i < canvas_id.length; i++){
    let canvas = document.getElementById(canvas_id[i]);
    canvas.width = 530;
    canvas.height = 280;
    let gl = canvas.getContext("webgl2", {preserveDrawingBuffer: true});
    canvas_s.push(canvas);
    gl_s.push(gl);
    objects_to_draw_s[i] = [];

    if(canvas_id[i] != "canvas_water"){
        objects_to_draw_s[i].push({
            vertex_shader: canvas_id[i]+"_vertex.glsl",
            fragment_shader: canvas_id[i]+"_fragment.glsl",
            transform: {
                position: [-grid_size[0]/2, 0, -grid_size[1]/2],
                scale: [1, 1, 1],
                rotation: quat_id()
            },
            shader: {
                program: null,
                uniforms: {}
            },
            draw_count: null,
            vao: null,
            texture: null,
            normal: null,
            lines: i == 0
        });
    }
    else{
        let d = Math.floor(tile_size/2);
        for(let j = -d; j < d+1; j++){
            for(let k = -d; k < d+1; k++){
                objects_to_draw_s[i].push({
                    vertex_shader: canvas_id[i]+"_vertex.glsl",
                    fragment_shader: canvas_id[i]+"_fragment.glsl",
                    transform: {
                        position: [
                            (j*grid_size[0])-(grid_size[0]/2), 0,
                            (k*grid_size[0])-(grid_size[1]/2)
                        ],
                        scale: [1, 1, 1],
                        rotation: quat_id()
                    },
                    shader: {
                        program: null,
                        uniforms: {}
                    },
                    draw_count: null,
                    vao: null,
                    texture: null,
                    normal: null,
                    lines: i == 0
                });
            }
        }

        for(let j = -d; j < d+1; j++){
            for(let k = -d; k < d+1; k++){
                objects_to_draw_s[i].push({
                    vertex_shader: "water_vertex.glsl",
                    fragment_shader: "water_fragment.glsl",
                    transform: {
                        position: [
                            (j*grid_size[0])-(grid_size[0]/2), 0,
                            (k*grid_size[0])-(grid_size[1]/2)
                        ],
                        scale: [1, 1, 1],
                        rotation: quat_id()
                    },
                    shader: {
                        program: null,
                        uniforms: {}
                    },
                    draw_count: null,
                    vao: null,
                    texture: null,
                    normal: null,
                    lines: 0
                });
            }
        }
        shaders_files.push([i, "water_vertex.glsl"]);
        shaders_files.push([i, "water_fragment.glsl"]);
    }

    shaders_files.push([i, canvas_id[i]+"_vertex.glsl"]);
    shaders_files.push([i, canvas_id[i]+"_fragment.glsl"]);

    image_data1 = ctx_noise_1.getImageData(0, 0, texture_size, texture_size);
    data1 = image_data1.data;
    image_data2 = ctx_noise_2.getImageData(0, 0, texture_size, texture_size);
    data2 = image_data2.data;
    image_data3 = ctx_normal.getImageData(0, 0, texture_size, texture_size);
    data3 = image_data3.data;
}

let main_camera = {
    fov: 60,
    near_plane: 0.1,
    far_plane: 10000,
    position: [0, 50, -70],
    rotation: [Math.PI/2, -Math.PI/4, 0]
};

let shaders_s = [];

let vertices = [];
let indices = [];

function init_grid_vertex(){
    let vertex_count = (grid_size[0]+1)*(grid_size[1]+1);
    let x_count = 0, y_count = 0;
    for(let i = 0; i < vertex_count*6; i+=6){
        vertices[i] = x_count;
        vertices[i+1] = 0.0;
        vertices[i+2] = y_count;

        vertices[i+3] = 0;
        vertices[i+4] = 1;
        vertices[i+5] = 0;
        x_count++;
        if(x_count%(grid_size[0]+1) == 0){
            x_count = 0;
            y_count++;
        }
    }
    for(let j = 0; j < grid_size[1]; j++){
        for(let i = 0; i < grid_size[0]; i++){
            let quad = i+j*grid_size[0];
            indices[(quad*6)] = quad+j;
            indices[(quad*6)+1] = indices[quad*6+4] = (quad+j)+grid_size[0]+1;
            indices[(quad*6)+2] = indices[quad*6+3] = quad+j+1;
            indices[(quad*6)+5] = (quad+j)+grid_size[0]+2;
        }
    }
}

function grid_vertex_buffer(gl){
    let vertex_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    let index_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    return [vertex_buffer, index_buffer, indices.length];
}

function init(id){
    let gl = gl_s[id];
    let objects_to_draw = objects_to_draw_s[id];
    let shaders = shaders_s[id];
    for(let i = 0; i < objects_to_draw.length; i++){
        let shader_program = link_shader_program(gl,
            shaders[objects_to_draw[i].vertex_shader],
            shaders[objects_to_draw[i].fragment_shader], null);
        objects_to_draw[i].shader.program = shader_program;
        gl.useProgram(objects_to_draw[i].shader.program);

        let n_uniforms = gl.getProgramParameter(shader_program, gl.ACTIVE_UNIFORMS);

        for(let j = 0; j < n_uniforms; j++){
            let uniform = gl.getActiveUniform(shader_program, j);
            objects_to_draw[i].shader.uniforms[uniform["name"]] = {
                type: uniform["type"],
                location: gl.getUniformLocation(shader_program, uniform["name"])
            };
        }

        let vao = gl.createVertexArray();
        objects_to_draw[i].vao = vao;
        gl.bindVertexArray(vao);

        let vertex_buffer = grid_vertex_buffer(gl);
        objects_to_draw[i].draw_count = vertex_buffer[2];

        gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer[0]);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vertex_buffer[1]);
        let position_attrib_location = gl.getAttribLocation(shader_program, "position_attrib");
        gl.enableVertexAttribArray(position_attrib_location);
        gl.vertexAttribPointer(position_attrib_location, 3, gl.FLOAT, false,
                                6*Float32Array.BYTES_PER_ELEMENT, 0);

        if(objects_to_draw[i].shader.uniforms["texture"] != null){
            gl.uniform1i(objects_to_draw[i].shader.uniforms["texture"].location, 0);
        }
        if(objects_to_draw[i].shader.uniforms["normal"] != null){
            gl.uniform1i(objects_to_draw[i].shader.uniforms["normal"].location, 1);
        }
    }
}

function draw_3d(id){
    let gl = gl_s[id];
    let camera = main_camera;
    let objects_to_draw = objects_to_draw_s[id];

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    let aspect_ratio = gl.canvas.width/gl.canvas.height;
    let p = perspective_projection(rad(camera.fov),
                                aspect_ratio,
                                camera.near_plane,
                                camera.far_plane);

    let x = camera.rotation[0];
    let y = camera.rotation[1];
    let forward = [
        Math.cos(x)*Math.cos(y),
        Math.sin(y),
        Math.sin(x)*Math.cos(y)
    ];

    let v = lookat_matrix(camera.position, vec3_add(camera.position, forward), [0, 1, 0]);

    for(let i = 0; i < objects_to_draw.length; i++){
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        if(i > tile_size*tile_size-1) gl.blendFunc(gl.SRC_ALPHA, gl.SRC_COLOR);

        gl.useProgram(objects_to_draw[i].shader.program);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, objects_to_draw[i].texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, objects_to_draw[i].normal);

        let m = mat4_identity();
        m = mat4_mat4_mul(rotate_3d(objects_to_draw[i].transform.rotation), m);
        m = mat4_mat4_mul(translate_3d(objects_to_draw[i].transform.position), m);
        m = mat4_mat4_mul(scale_3d(objects_to_draw[i].transform.scale), m);
        let mvp = mat4_identity();
        mvp = mat4_mat4_mul(m, mat4_mat4_mul(v, p));
        set_shader_uniform(gl, objects_to_draw[i].shader, "mvp", mvp);
        if("height_multiplier" in objects_to_draw[i].shader.uniforms){
            set_shader_uniform(gl, objects_to_draw[i].shader, "height_multiplier", height_multiplier);
        }
        if("height_addend" in objects_to_draw[i].shader.uniforms){
            set_shader_uniform(gl, objects_to_draw[i].shader, "height_addend", height_addend);
        }

        gl.bindVertexArray(objects_to_draw[i].vao);
        let draw_type = gl.TRIANGLES;
        if(objects_to_draw[i].lines) draw_type = gl.LINE_STRIP;
        gl.drawElements(draw_type, objects_to_draw[i].draw_count, gl.UNSIGNED_SHORT, 0);
    }
}

function update(new_noise){
    seed = seed_input.value+"";
    octaves = parseInt(ocataves_input.value);
    height_multiplier = parseFloat(height_multiplier_input.value);
    height_addend = parseFloat(height_addend_input.value);
    normal_strength = parseFloat(normal_strength_input.value);
    if(new_noise){
        rand = xmur3(seed);
        noise = get_noise_function(generate_permutation_table(rand));
        draw_texture();
    }
    for(let i = 0; i < canvas_count; i++){
        if(new_noise){
            let gl = gl_s[i];
            let objects_to_draw = objects_to_draw_s[i];

            for(let j = 0; j < objects_to_draw.length; j++){
                let texture = gl.createTexture();
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                let noise_texture_;
                if(j < noise_texture.length){
                    noise_texture_ = noise_texture[j];
                }
                else{
                    noise_texture_ = noise_texture[j-noise_texture.length];
                }
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture_size, texture_size,
                            0, gl.RGBA, gl.UNSIGNED_BYTE, noise_texture_.data);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                objects_to_draw_s[i][j].texture = texture;

                let normal = gl.createTexture();
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, normal);
                let normal_texture_;
                if(j < normal_texture.length){
                    normal_texture_ = normal_texture[j];
                }
                else{
                    normal_texture_ = normal_texture[j-normal_texture.length];
                }
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture_size, texture_size,
                            0, gl.RGBA, gl.UNSIGNED_BYTE, normal_texture_.data);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                objects_to_draw_s[i][j].normal = normal;
            }
        }
        draw_3d(i);
    }
};

(async function(){
    for(let shader of shaders_files){
        let res = await fetch(shader[1]);
        let text = await res.text();
        if(shader[0] >= shaders_s.length) shaders_s.push({});
        shaders_s[shader[0]][shader[1]] = text;
    }
    draw_texture();
    init_grid_vertex();
    for(let i = 0; i < canvas_count; i++){
        init(i);
    }
    update(true);
})();

let dragging = -1;
for(let i = 0; i < canvas_count; i++){
    (function(i){
        canvas_s[i].addEventListener("mousedown", function(e){
            dragging = i;
        });
    })(i);
}
document.addEventListener("mouseup", function(e){
    dragging = -1;
});
document.addEventListener("mousemove", function(e){
    if(dragging > -1){
        let x = e.movementX;
        let y = e.movementY;
        if(canvas_id[dragging] != "canvas_water"){
            objects_to_draw_s[dragging][0].transform.rotation = quat_mul(
                objects_to_draw_s[dragging][0].transform.rotation,
                euler_to_quat([0, x/100, 0]));
        }
        else{
            for(let i = 0; i < objects_to_draw_s[dragging].length; i++){
                objects_to_draw_s[dragging][i].transform.rotation = quat_mul(
                    objects_to_draw_s[dragging][i].transform.rotation,
                    euler_to_quat([0, x/100, 0]));
            }
        }
        draw_3d(dragging);
    }
});

document.addEventListener("keydown", function(e){
    switch(e.keyCode){
        case 71:
            seed_input.value = Math.floor(Math.random()*10000)+"";
            update(true);
            break;
        case 83:
            height_addend_input.value--;
            update(false);
            break;
        case 87:
            height_addend_input.value++;
            update(false);
            break;
    }
});
