function draw_arrow(ctx, from, to, color){
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    let head = 17;
    let dx = to[0]-from[0];
    let dy = to[1]-from[1];
    let angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    let direction = vec2_normalize(vec2_sub(from, to));
    let to_ = vec2_add(to, vec2_scale(direction, 10));
    ctx.lineTo(to_[0], to_[1]);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(to[0]-head*Math.cos(angle-Math.PI/6),
               to[1]-head*Math.sin(angle-Math.PI/6));
    ctx.lineTo(to[0], to[1]);
    ctx.lineTo(to[0]-head*Math.cos(angle+Math.PI/6),
             to[1]-head*Math.sin(angle+Math.PI/6));
    ctx.fill();
}

function draw_line(ctx, from, to, color){
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(from[0], from[1]);
    ctx.lineTo(to[0], to[1]);
    ctx.stroke();
}

function draw_circle(ctx, center, radius, fill, color){
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(center[0], center[1], radius, 0, 2*Math.PI);
    if(!fill) ctx.stroke();
    if(fill) ctx.fill();
}

function draw_rect(ctx, pos, size, fill, color){
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.rect(
        pos[0]-size[0]/2,
        pos[1]-size[1]/2,
        size[0],
        size[1],
    );
    if(!fill) ctx.stroke();
    if(fill) ctx.fill();
}

function point_rect_dist(point, rect_pos, rect_size){
    let dist = vec2_magnitude([
        Math.max(Math.abs(point[0]-rect_pos[0])-rect_size[0]/2, 0),
        Math.max(Math.abs(point[1]-rect_pos[1])-rect_size[1]/2, 0),
    ]);

    let points = [];
    let cond1 = point[1] >= rect_pos[1]-rect_size[1]/2 && point[1] <= rect_pos[1]+rect_size[1]/2;
    let cond2 = point[0] >= rect_pos[0]-rect_size[0]/2 && point[0] <= rect_pos[0]+rect_size[0]/2;
    if(cond1){
        points = points.concat([
            [rect_pos[0]-rect_size[0]/2, point[1]],
            [rect_pos[0]+rect_size[0]/2, point[1]]
        ]);
    }
    if(cond2){
        points = points.concat([
            [point[0], rect_pos[1]-rect_size[1]/2],
            [point[0], rect_pos[1]+rect_size[1]/2]
        ]);
    }

    points = points.concat([
        [rect_pos[0]-rect_size[0]/2, rect_pos[1]-rect_size[1]/2],
        [rect_pos[0]+rect_size[0]/2, rect_pos[1]-rect_size[1]/2],
        [rect_pos[0]-rect_size[0]/2, rect_pos[1]+rect_size[1]/2],
        [rect_pos[0]+rect_size[0]/2, rect_pos[1]+rect_size[1]/2],
    ]);

    let closest_point;
    let min_dist = Number.POSITIVE_INFINITY;
    for(let point_ of points){
        let dist = distance(point, point_);
        if(dist < min_dist){
            min_dist = dist;
            closest_point = point_;
        }
    }
    if(cond1 && cond2) min_dist *= -1;

    return [closest_point, dist];
}

function point_circle_dist(point, circle_pos, circle_radius){
    let dir = vec2_normalize(vec2_sub(point, circle_pos));
    let closest_point = vec2_add(circle_pos, vec2_scale(dir, circle_radius));
    return [closest_point, distance(circle_pos, point)-circle_radius];
}

function update_draggables($, draggables){
    if($.set_to_null) $.dragging = null;
    let found_draggable = false;
    if($.dragging == null){
        for(let draggable of draggables){
            if(distance($.mouse_pos, $[draggable]) < 15){
                document.body.style.cursor = "move";
                found_draggable = true;
                if($.mouse_state == 1){
                    $.dragging = draggable;
                    $.set_to_null = false;
                }
            }
        }
    }
    else{
        $[$.dragging] = $.mouse_pos;
        document.body.style.cursor = "move";
    }

    if($.mouse_state == 0){
        $.set_to_null = true;
        if(!found_draggable) document.body.style.cursor = "initial";
    }
}

function draw_text(ctx, txt, pos, font, color){
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt, pos[0], pos[1]);
}

function draw_canvas_euclidean_distance(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");

    if($.dragging == undefined) $.dragging = null;
    if($.point1 == undefined) $.point1 = [122, 38];
    if($.point2 == undefined) $.point2 = [390, 202];
    let draggables = ["point1", "point2"];
    update_draggables($, draggables);

    let point3 = [$.point2[0], $.point1[1]];
    let right_angle_size = 15;
    let add_y = -right_angle_size;
    let add_x = right_angle_size;
    if($.point1[0] < $.point2[0]) add_x *= -1;
    if($.point1[1] < $.point2[1]) add_y *= -1;
    let right_angle_1 = [point3[0], point3[1]+add_y];
    let right_angle_2 = [point3[0]+add_x, point3[1]+add_y];
    let right_angle_3 = [point3[0]+add_x, point3[1]];

    ctx.lineWidth = 5;

    draw_line(ctx, $.point1, $.point2, "#ea3333");

    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.beginPath();
    ctx.moveTo($.point1[0], $.point1[1]);
    ctx.lineTo(point3[0], point3[1]);
    ctx.lineTo($.point2[0], $.point2[1]);
    ctx.stroke();

    ctx.strokeStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(right_angle_1[0], right_angle_1[1]);
    ctx.lineTo(right_angle_2[0], right_angle_2[1]);
    ctx.lineTo(right_angle_3[0], right_angle_3[1]);
    ctx.stroke();

    draw_circle(ctx, $.point1, 8, true, "#2c66c9");
    draw_circle(ctx, $.point2, 8, true, "#29c643");

    draw_text(ctx, "P1", [$.point1[0]+add_x*1.5, $.point1[1]], "bold 18px sans-serif", "#000");
    draw_text(ctx, "P2", [$.point2[0]-add_x*1.5, $.point2[1]], "bold 18px sans-serif", "#000");

    let pos = vec2_lerp($.point2, $.point1, 0.5);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.translate(pos[0], pos[1]);
    if($.point1[0] < $.point2[0]){
        ctx.rotate(Math.atan2($.point2[1]-$.point1[1], $.point2[0]-$.point1[0]));
    }
    else{
        ctx.rotate(Math.atan2($.point1[1]-$.point2[1], $.point1[0]-$.point2[0]));
    }
    ctx.translate(-pos[0], -pos[1]);
    ctx.beginPath();
    let y_offset = 15;
    if($.point1[1] > $.point2[1]) y_offset = -30;
    if($.point1[1] > $.point2[1]) y_offset = -30;
    add_x = 0;
    add_y = 15;
    if($.point1[1] > $.point2[1]) add_y = -30;
    ctx.moveTo(pos[0]+110+add_x, pos[1]+add_y);
    ctx.lineTo(pos[0]-105+add_x, pos[1]+add_y);
    ctx.lineTo(pos[0]-108+add_x, pos[1]+add_y+18);
    ctx.lineTo(pos[0]-112+add_x, pos[1]+add_y+10);
    ctx.stroke();
    draw_text(ctx, " (P1.x-P2.x)\u00B2+(P1.y-P2.y)\u00B2", [pos[0]+add_x, pos[1]+12+add_y], "bold 14px mono", "#000");
    ctx.restore();

    document.querySelector("#euclidean-distance").innerHTML = Math.round(distance($.point1, $.point2));
}

function draw_canvas_circle_sdf(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");

    if($.dragging == undefined) $.dragging = null;
    if($.center == undefined) $.center = [271, 112];
    if($.point == undefined) $.point = [439, 158];

    let draggables = ["center", "point"];
    update_draggables($, draggables);

    let radius = 70;
    let [closest_point, min_dist] = point_circle_dist($.point, $.center, radius);

    ctx.lineWidth = 4;

    draw_arrow(ctx, $.center, closest_point, "#ff8f00");
    draw_arrow(ctx, $.point, closest_point, "#ea3333");
    draw_circle(ctx, $.center, radius, false, "#000");
    draw_circle(ctx, $.center, 6, true, "#29c643");
    draw_circle(ctx, $.point, 6, true, "#2c66c9");

    let add_x = 15;
    if($.point[0] < $.center[0]) add_x *= -1;
    draw_text(ctx, "P", [$.point[0]+add_x, $.point[1]], "bold 18px sans-serif", "#000");
    draw_text(ctx, "C", [$.center[0]+10, $.center[1]-10], "bold 18px sans-serif", "#000");

    document.querySelector("#circle-distance").innerHTML = Math.round(min_dist);
}

function draw_canvas_rect_sdf(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");

    if($.dragging == undefined) $.dragging = null;
    if($.point == undefined) $.point = [419, 178];
    let draggables = ["point"];

    let rect_pos, rect_size;

    if($["corner_0"] == undefined){
        rect_size = [100, 100];
        rect_pos = [
            ctx.canvas.width/2,
            ctx.canvas.height/2
        ];
        $["corner_"+0] = [rect_pos[0]-rect_size[0]/2, rect_pos[1]-rect_size[1]/2];
        $["corner_"+1] = [rect_pos[0]+rect_size[0]/2, rect_pos[1]-rect_size[1]/2];
        $["corner_"+2] = [rect_pos[0]-rect_size[0]/2, rect_pos[1]+rect_size[1]/2];
        $["corner_"+3] = [rect_pos[0]+rect_size[0]/2, rect_pos[1]+rect_size[1]/2];
    }

    for(let i = 0; i < 4; i++){
        draggables.push("corner_"+i);
    }
    update_draggables($, draggables);

    if($.dragging == "corner_0"){
        $.corner_1[1] = $.corner_0[1];
        $.corner_2[0] = $.corner_0[0];
    }
    if($.dragging == "corner_1"){
        $.corner_0[1] = $.corner_1[1];
        $.corner_3[0] = $.corner_1[0];
    }
    if($.dragging == "corner_2"){
        $.corner_0[0] = $.corner_2[0];
        $.corner_3[1] = $.corner_2[1];
    }
    if($.dragging == "corner_3"){
        $.corner_1[0] = $.corner_3[0];
        $.corner_2[1] = $.corner_3[1];
    }

    rect_size = [
        Math.abs($.corner_0[0]-$.corner_1[0]),
        Math.abs($.corner_0[1]-$.corner_2[1])
    ];
    rect_pos = [
        Math.min($.corner_0[0], $.corner_1[0])+rect_size[0]/2,
        Math.min($.corner_0[1], $.corner_2[1])+rect_size[1]/2,
    ];


    ctx.lineWidth = 4;
    draw_rect(ctx, rect_pos, rect_size, false, "#000");
    ctx.lineWidth = 5;
    let top_left = vec2_sub(rect_pos, vec2_scale(rect_size, 0.5));
    draw_line(ctx, top_left, vec2_add(top_left, [rect_size[0], 0]), "#ff8f00");
    draw_line(ctx, top_left, vec2_add(top_left, [0, rect_size[1]]), "#ff8f00");
    for(let i = 0; i < 4; i++){
        draw_circle(ctx, $["corner_"+i], 5, true, "#000");
    }

    let [closest_point, min_dist] = point_rect_dist($.point, rect_pos, rect_size);
    document.querySelector("#rect-distance").innerHTML = Math.round(min_dist);

    draw_arrow(ctx, $.point, closest_point, "#ea3333");
    draw_circle(ctx, $.point, 6, true, "#2c66c9");

    draw_circle(ctx, rect_pos, 6, true, "#29c643");
    draw_text(ctx, "C", [rect_pos[0]-15, rect_pos[1]], "bold 18px sans-serif", "#000");

    let add_x = 17;
    if($.point[0] < rect_pos[0]) add_x *= -1;
    draw_text(ctx, "P", [$.point[0]+add_x, $.point[1]], "bold 18px sans-serif", "#000");
}

function draw_canvas_shapes_sdf(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");

    if($.dragging == undefined) $.dragging = null;
    if($.point == undefined) $.point = [439, 158];
    let draggables = ["point"];
    update_draggables($, draggables);

    ctx.lineWidth = 4;

    let shapes = [];

    let rect_size = [100, 100];
    let rect_pos = [530, 190];
    shapes.push(["rect", rect_size, rect_pos]);
    draw_rect(ctx, rect_pos, rect_size, false, "#000");

    rect_size = [90, 150];
    rect_pos = [50, 90];
    shapes.push(["rect", rect_size, rect_pos]);
    draw_rect(ctx, rect_pos, rect_size, false, "#000");

    let circle_radius = 50;
    let circle_pos = [360, 60];
    shapes.push(["circle", circle_pos, circle_radius]);
    draw_circle(ctx, circle_pos, circle_radius, false, "#000");

    circle_radius = 80;
    circle_pos = [250, 215];
    shapes.push(["circle", circle_pos, circle_radius]);
    draw_circle(ctx, circle_pos, circle_radius, false, "#000");

    let dist = Number.POSITIVE_INFINITY;
    let closest_point;
    for(let shape of shapes){
        let tmp_closest_point, tmp_dist;
        if(shape[0] == "circle"){
            [tmp_closest_point, tmp_dist] = point_circle_dist($.point, shape[1], shape[2]);
        }
        else if(shape[0] == "rect"){
            [tmp_closest_point, tmp_dist] = point_rect_dist($.point, shape[2], shape[1]);
        }
        if(tmp_dist < dist){
            dist = tmp_dist;
            closest_point = tmp_closest_point;
        }
        draw_arrow(ctx, $.point, tmp_closest_point, "#aaa");
    }
    draw_arrow(ctx, $.point, closest_point, "#ea3333");
    draw_circle(ctx, $.point, 6, true, "#2c66c9");
    draw_text(ctx, "P", [$.point[0]-14, $.point[1]], "bold 18px sans-serif", "#000");
    if(dist < 0) return;
    draw_circle(ctx, $.point, dist, false, "#ea3333");
}

function draw_canvas_raymarching_1(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");

    if($.dragging == undefined) $.dragging = null;
    if($.point == undefined) $.point = [150, 140];
    let draggables = ["point"];
    update_draggables($, draggables);

    ctx.lineWidth = 4;

    let shapes = [];

    let rect_size = [100, 100];
    let rect_pos = [470, 150];
    shapes.push(["rect", rect_size, rect_pos]);
    draw_rect(ctx, rect_pos, rect_size, false, "#000");

    let circle_radius = 50;
    let circle_pos = [360, 60];
    shapes.push(["circle", circle_pos, circle_radius]);
    draw_circle(ctx, circle_pos, circle_radius, false, "#000");

    circle_radius = 65;
    circle_pos = [260, 230];
    shapes.push(["circle", circle_pos, circle_radius]);
    draw_circle(ctx, circle_pos, circle_radius, false, "#000");

    let camera = [30, ctx.canvas.height/2];

    ctx.lineWidth = 3;

    let current_point = camera;
    let path = vec2_normalize(vec2_sub($.point, camera));
    let dist_sum = 0;
    let points = [];
    for(let t = 0; t < 100; t++){
        let dist = Number.POSITIVE_INFINITY;
        let closest_point;

        for(let shape of shapes){
            let tmp_closest_point, tmp_dist;
            if(shape[0] == "circle"){
                [tmp_closest_point, tmp_dist] = point_circle_dist(current_point, shape[1], shape[2]);
            }
            else if(shape[0] == "rect"){
                [tmp_closest_point, tmp_dist] = point_rect_dist(current_point, shape[2], shape[1]);
            }
            if(tmp_dist < dist){
                dist = tmp_dist;
                closest_point = tmp_closest_point;
            }
        }
        if(dist <= 3) break;
        if(dist >= 500) break;
        draw_circle(ctx, current_point, dist, false, "#ea3333");
        points.push(current_point);
        dist_sum += dist;
        current_point = vec2_add(camera, vec2_scale(path, dist_sum));
    }
    ctx.lineWidth = 3;
    draw_line(ctx, camera, current_point, "#000");
    draw_arrow(ctx, camera, $.point, "#2c66c9");
    draw_circle(ctx, camera, 8, true, "#29c643");
    points.shift();
    for(let point of points){
        draw_circle(ctx, point, 5, true, "#ea3333");
    }
}

function draw_canvas_raymarching_2(ctx, $){
    draw_rect(ctx, [ctx.canvas.width/2, ctx.canvas.height/2], [ctx.canvas.width, ctx.canvas.height], true, "#fff");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    let camera = [30, ctx.canvas.height/2];
    let near_plane = parseInt(document.getElementById("near-plan").value);
    let fov = rad(parseInt(document.getElementById("fov").value));
    let view_length = near_plane*Math.tan(fov);
    let nb_rays = parseInt(document.getElementById("nb-rays").value);
    let nb_iterations = parseInt(document.getElementById("iterations").value);

    let circle_pos = [410, ctx.canvas.height/2];
    let circle_radius = 100;
    ctx.lineWidth = 4;
    draw_circle(ctx, circle_pos, circle_radius, false, "#000");

    let ray_spacing = view_length*2/(nb_rays-1);

    let points = [];
    ctx.lineWidth = 1;
    for(let i = 0; i < nb_rays; i++){
        let ray_point = [camera[0]+near_plane, (ctx.canvas.height/2)-view_length+i*ray_spacing];
        draw_line(ctx, camera, ray_point, "#000");
        let ray = vec2_normalize(vec2_sub(ray_point, camera));
        let current_point = ray_point;
        for(let t = 0; t < nb_iterations; t++){
            let [closest_point, dist] = point_circle_dist(current_point, circle_pos, circle_radius);
                let new_point = vec2_add(current_point, vec2_scale(ray, dist));
            draw_line(ctx, current_point, new_point, "#000");
            current_point = new_point;
            if(dist <= 3){
                points.push([new_point, true]);
                break;
            }
            points.push([new_point, false]);
            if(dist >= 500) break;
        }
    }

    points.sort(function(a, b){
        return a[1] > b[1];
    });
    for(let point of points){
        draw_circle(ctx, point[0], 5, true, point[1] ? "#ea3333" : "#000");
    }

    ctx.lineWidth = 4;
    draw_circle(ctx, camera, 8, true, "#29c643");
    draw_line(ctx,
        [camera[0]+near_plane, ctx.canvas.height/2-view_length],
        [camera[0]+near_plane, ctx.canvas.height/2+view_length], "#29c643");
    draw_line(ctx, camera, [camera[0]+near_plane, ctx.canvas.height/2+view_length], "#29c643");
    draw_line(ctx, camera, [camera[0]+near_plane, ctx.canvas.height/2-view_length], "#29c643");
}

let canvases_id = [
    "canvas-euclidean-distance",
    "canvas-circle-sdf",
    "canvas-rect-sdf",
    "canvas-shapes-sdf",
    "canvas-raymarching-1",
    "canvas-raymarching-2",
];

let canvases = [];
let ctxs = [];
let canvas_draw_function = [];
let canvas_vars = [];
for(let canvas_id of canvases_id){
    let canvas = document.getElementById(canvas_id);
    canvases.push(canvas);
    ctxs.push(canvas.getContext("2d"));
    canvas_vars.push({mouse_pos: [0, 0], mouse_state: 0});
    canvas_draw_function.push(window["draw_"+canvas_id.replaceAll("-", "_")])
}

document.getElementById("near-plan").oninput =
document.getElementById("fov").oninput =
document.getElementById("nb-rays").oninput =
document.getElementById("iterations").oninput =
function(){
    draw_canvas_raymarching_2(ctxs[5], canvas_vars[5], [0, 0], 0);
};

let raymarching_animation;
document.getElementById("raymarching-play").onclick = function(){
    clearInterval(raymarching_animation);
    let current_iteration = 0;
    function f(){
        document.getElementById("iterations").value = current_iteration;
        draw_canvas_raymarching_2(ctxs[5], canvas_vars[5], [0, 0], 0);
        current_iteration++;
        if(current_iteration > document.getElementById("iterations").max) clearInterval(raymarching_animation);
    }
    f();
    raymarching_animation = setInterval(function(){
        f();
    }, 400);
};

for(let [i, canvas] of canvases.entries()){
    canvas.width = 600;
    canvas.height = 300;

    (function(i, canvas){
        canvas.addEventListener("mousemove", function(e){
            let rect = e.target.getBoundingClientRect();
            let x = e.clientX-rect.left;
            let y = e.clientY-rect.top;
            canvas_vars[i].mouse_pos = [x, y];
            canvas_draw_function[i](ctxs[i], canvas_vars[i], [x, y], e.buttons);
        });
        canvas.addEventListener("mousedown", function(e){
            canvas_vars[i].mouse_state = 1;
        });
        canvas.addEventListener("mouseup", function(e){
            canvas_vars[i].mouse_state = 0;
        });
    })(i, canvas);
    canvas_draw_function[i](ctxs[i], canvas_vars[i], [400, 150], 0);
}

///////////////////////////


let default_vertex_shader = `#version 300 es

layout(location = 0) in vec3 position_attrib;

out vec3 position;

void main(){
    gl_Position = vec4(position_attrib, 1);
    position = position_attrib;
}`;

let default_vertices = [
    -1, 1, 0,
    1, -1, 0,
    -1, -1, 0,

    -1, 1, 0,
    1, 1, 0,
    1, -1, 0
];

function init_3d(canvas_id, fragment_shader){
    let canvas = document.getElementById(canvas_id);
    let gl = canvas.getContext("webgl2");
    canvas.width = 300;
    canvas.height = 300;

    let vao, vbo;

    let shader_program = link_shader_program(gl, default_vertex_shader, fragment_shader, null);
    let n_uniforms = gl.getProgramParameter(shader_program, gl.ACTIVE_UNIFORMS);
    let shader = {
        program: shader_program,
        uniforms: {}
    };

    for(let i = 0; i < n_uniforms; i++){
        let uniform = gl.getActiveUniform(shader_program, i);
        shader.uniforms[uniform["name"]] = {
            type: uniform["type"],
            location: gl.getUniformLocation(shader_program, uniform["name"])
        };
    }

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(default_vertices), gl.STATIC_DRAW);
    let position_attrib_location = gl.getAttribLocation(shader_program, "position_attrib");
    gl.enableVertexAttribArray(position_attrib_location);
    gl.vertexAttribPointer(position_attrib_location, 3, gl.FLOAT, false, 3*Float32Array.BYTES_PER_ELEMENT, 0);
    return [gl, vao, shader];
}

function draw_3d(gl, vao, shader){
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(shader.program);
    set_shader_uniform(gl, shader, "aspect_ratio", gl.canvas.height/gl.canvas.width);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, default_vertices.length/3);
}

let gl_canvases_id = [
   "canvas-webgl-1",
   "canvas-webgl-2",
   "canvas-webgl-3",
   "canvas-webgl-4",
   "canvas-webgl-5",
];

let fragment_shaders = [
`#version 300 es
precision highp float;

in vec3 position;

uniform float aspect_ratio;

out vec4 frag_color;

void main(){
    vec2 uv = vec2(position.x, position.y*aspect_ratio);
    frag_color = vec4(uv.x, uv.y, 0, 1);
}`,

`#version 300 es
precision highp float;

in vec3 position;

uniform float aspect_ratio;

out vec4 frag_color;

int march_max_iterations = 100;
float min_march_dist = 0.001;
float max_march_dist = 1000.;

float sphere(vec3 point, vec3 position, float radius){
    return length(point-position)-radius;
}

float march(vec3 ray_origin, vec3 ray_direction){
    vec3 current_point = ray_origin;
    float total_dist = 0.;
    for(int i = 0; i < march_max_iterations; i++){
        current_point = ray_origin+ray_direction*total_dist;
        float dist = sphere(current_point, vec3(0., 0., 2.), 0.5);
        total_dist += dist;
        if(dist < min_march_dist){
            break;
        }
        if(total_dist > max_march_dist){
            break;
        }
    }
    return total_dist;
}

void main(){
    vec2 uv = vec2(position.x, position.y*aspect_ratio);

    vec3 ray_origin = vec3(0.);
    vec3 ray_direction = normalize(vec3(uv.x, uv.y, 1.)-ray_origin);
    float dist = march(ray_origin, ray_direction);
    dist /= 7.;
    frag_color = vec4(vec3(dist), 1.);
}`,

`#version 300 es
precision highp float;

in vec3 position;

uniform float aspect_ratio;

out vec4 frag_color;

int march_max_iterations = 100;
float min_march_dist = 0.001;
float max_march_dist = 1000.;

float sphere(vec3 point, vec3 position, float radius){
    return length(point-position)-radius;
}

float box(vec3 point, vec3 position, vec3 size){
    vec3 d = abs(point-position)-size;
    return min(max(d.x, max(d.y, d.z)), 0.0)+length(max(d, 0.0));
}

float plane(vec3 point, vec3 position, vec3 normal) {
    return abs(dot(point-position, normal));
}

float scene(vec3 point){
    float plane1 = plane(point, vec3(0, -0.9, 0), vec3(0, 1, 0));
    float sphere1 = sphere(point, vec3(-0.7, 0., 2.), 0.5);
    float box1 = box(point, vec3(0.7, 0., 2.), vec3(0.4, 0.4, 0.4));
    return min(plane1, min(sphere1, box1));
}

float march(vec3 ray_origin, vec3 ray_direction){
    vec3 current_point = ray_origin;
    float total_dist = 0.;
    for(int i = 0; i < march_max_iterations; i++){
        current_point = ray_origin+ray_direction*total_dist;
        float dist = scene(current_point);
        total_dist += dist;
        if(dist < min_march_dist){
            break;
        }
        if(total_dist > max_march_dist){
            break;
        }
    }
    return total_dist;
}

void main(){
    vec2 uv = vec2(position.x, position.y*aspect_ratio);

    vec3 ray_origin = vec3(0.);
    vec3 ray_direction = normalize(vec3(uv.x, uv.y, 1.)-ray_origin);
    float dist = march(ray_origin, ray_direction);
    dist /= 7.;
    frag_color = vec4(vec3(dist), 1.);
}`,

`#version 300 es
precision highp float;

in vec3 position;

uniform float aspect_ratio;

out vec4 frag_color;

int march_max_iterations = 300;
float min_march_dist = 0.001;
float max_march_dist = 1000.;

float sphere(vec3 point, vec3 position, float radius){
    return length(point-position)-radius;
}

float box(vec3 point, vec3 position, vec3 size){
    vec3 d = abs(point-position)-size;
    return min(max(d.x, max(d.y, d.z)), 0.0)+length(max(d, 0.0));
}

float plane(vec3 point, vec3 position, vec3 normal) {
    return abs(dot(point-position, normal));
}

vec2 vec_min(vec2 a, vec2 b) {
    return a.x > b.x ? b : a;
}

vec2 scene(vec3 point){
    vec2 plane1 = vec2(plane(point, vec3(0, -0.9, 0), vec3(0, 1, 0)), 1.0);
    vec2 sphere1 = vec2(sphere(point, vec3(-0.7, 0., 2.), 0.5), 2.0);
    vec2 box1 = vec2(box(point, vec3(0.7, 0., 2.), vec3(0.4, 0.4, 0.4)), 3.0);
    return vec_min(plane1, vec_min(sphere1, box1));
}

vec2 march(vec3 ray_origin, vec3 ray_direction){
    vec3 current_point = ray_origin;
    float total_dist = 0.;
    float id;
    for(int i = 0; i < march_max_iterations; i++){
        current_point = ray_origin+ray_direction*total_dist;

        vec2 s = scene(current_point);
        id = s.y;
        float dist = s.x;
        total_dist += dist;

        if(dist < min_march_dist){
            break;
        }
        if(total_dist > max_march_dist){
            id = 0.;
            break;
        }
    }
    return vec2(total_dist, id);
}

vec3 material(int id){
    if(id == 1){
        return vec3(0.7);
    } else if(id == 2) {
        return vec3(1.0, 0.0, 0.0);
    } else if(id == 3) {
        return vec3(0.0, 0.0, 1.0);
    }
     else if(id == 0) {
        return vec3(0.480, 0.856, 1.000);
    }
}

void main(){
    vec2 uv = vec2(position.x, position.y*aspect_ratio);

    vec3 ray_origin = vec3(0.);
    vec3 ray_direction = normalize(vec3(uv.x, uv.y, 1.)-ray_origin);
    vec2 march_out = march(ray_origin, ray_direction);
    float dist = march_out.x;
    vec3 col = material(int(march_out.y));
    frag_color = vec4(col, 1.);
}`,

`#version 300 es
precision highp float;

in vec3 position;

uniform float aspect_ratio;

out vec4 frag_color;

int march_max_iterations = 300;
float min_march_dist = 0.001;
float max_march_dist = 1000.;

float sphere(vec3 point, vec3 position, float radius){
    return length(point-position)-radius;
}

float box(vec3 point, vec3 position, vec3 size){
    vec3 d = abs(point-position)-size;
    return min(max(d.x, max(d.y, d.z)), 0.0)+length(max(d, 0.0));
}

float plane(vec3 point, vec3 position, vec3 normal) {
    return abs(dot(point-position, normal));
}

vec2 vec_min(vec2 a, vec2 b) {
    return a.x > b.x ? b : a;
}

vec2 scene(vec3 point){
    vec2 plane1 = vec2(plane(point, vec3(0, -0.9, 0), vec3(0, 1, 0)), 1.0);
    vec2 sphere1 = vec2(sphere(point, vec3(-0.7, 0., 2.), 0.5), 2.0);
    vec2 box1 = vec2(box(point, vec3(0.7, 0., 2.), vec3(0.4, 0.4, 0.4)), 3.0);
    return vec_min(plane1, vec_min(sphere1, box1));
}

vec2 march(vec3 ray_origin, vec3 ray_direction){
    vec3 current_point = ray_origin;
    float total_dist = 0.;
    float id;
    for(int i = 0; i < march_max_iterations; i++){
        current_point = ray_origin+ray_direction*total_dist;

        vec2 s = scene(current_point);
        id = s.y;
        float dist = s.x;
        total_dist += dist;

        if(dist < min_march_dist){
            break;
        }
        if(total_dist > max_march_dist){
            id = 0.;
            break;
        }
    }
    return vec2(total_dist, id);
}

vec3 material(int id){
    if(id == 1){
        return vec3(0.7);
    } else if(id == 2) {
        return vec3(1.0, 0.0, 0.0);
    } else if(id == 3) {
        return vec3(0.0, 0.0, 1.0);
    }
}

vec3 normal(vec3 point) {
    if (point.z > 1000.) return vec3(0.);
    float dist = scene(point).x;
    float delta = 0.001;
    vec2 dir = vec2(delta, 0.);
    float dx = scene(point + dir.xyy).x - dist;
    float dy = scene(point + dir.yxy).x - dist;
    float dz = scene(point + dir.yyx).x - dist;
    return normalize(vec3(dx, dy, dz));
}

void main(){
    vec2 uv = vec2(position.x, position.y*aspect_ratio);

    vec3 ray_origin = vec3(0.);
    vec3 ray_direction = normalize(vec3(uv.x, uv.y, 1.)-ray_origin);
    vec2 march_out = march(ray_origin, ray_direction);

    if(int(march_out.y) == 0) {
        frag_color = vec4(0.480, 0.856, 1.000, 1.0);
        return;
    }

    float depth = march_out.x;
    vec3 point = ray_origin + ray_direction * depth;

    vec3 light_direction = normalize(vec3(0.5, 2.0, -1.0));
    vec3 norm = normal(point);
    vec3 ambient = vec3(0.4);

    vec3 diffuse = vec3(max(0.0, dot(norm, light_direction)));
    if (march(point + norm * 0.01, light_direction).x < length(light_direction - point)) {
        diffuse = vec3(0.0);
    }
    diffuse += ambient;

    vec3 col = material(int(march_out.y))*diffuse;

    frag_color = vec4(col, 1.);
}`
];

let line_highlight = [
    [],
    [[13, 32]],
    [[17, 24], [27,27], [29, 30]],
    [[37, 71]],
    [[70, 79], [94, 106]],
];

let shaders = [];
let gls = [];
let vaos = [];
let editor_elements = document.querySelectorAll(".editor");
let editors = [];
for(let i = 0; i < editor_elements.length; i++){
    let editor = ace.edit(editor_elements[i]);
    editor.setTheme("ace/theme/monokai");
    editor.session.setMode("ace/mode/c_cpp");
    editors.push(editor);
    let button = document.createElement("button");
    button.innerHTML = "compile";
    button.className = "compile-button";
    editor_elements[i].appendChild(button);
    (function(button, i, editor){
        button.addEventListener("click", function(){
            fragment_shaders[i] = editor.getValue();
            let canvas_id = gl_canvases_id[i];
            let [gl, vao, shader] = init_3d(canvas_id, fragment_shaders[i]);
            shaders[i] = shader;
            gls[i] = gl;
            vaos[i] = vao;
            draw_3d(gl, vao, shaders[i]);
        });
    })(button, i, editor);
}
var Range = ace.require('ace/range').Range;

for(let i = 0; i < gl_canvases_id.length; i++){
    let canvas_id  = gl_canvases_id[i];
    let [gl, vao, shader] = init_3d(canvas_id, fragment_shaders[i]);
    shaders[i] = shader;
    gls[i] = gl;
    vaos[i] = vao;
    draw_3d(gl, vao, shaders[i]);
    editors[i].setValue(fragment_shaders[i]);
    editors[i].clearSelection();
    if(line_highlight[i].length > 0){
        for(let j = 0; j < line_highlight[i].length; j++){
            editors[i].session.addMarker(new Range(line_highlight[i][j][0], 0, line_highlight[i][j][1], 1), "marker", "fullLine");
        }
        editors[i].resize(true);
        editors[i].scrollToLine(line_highlight[i][0][0]+1, true, true, function () {});
        editors[i].gotoLine(line_highlight[i][0][0]+1, 0, true);
    }
}
