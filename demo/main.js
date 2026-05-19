let assets_to_load = [
    {name: "sphere_shader", path: ["assets/shaders/default.vert", "assets/shaders/sphere.frag"], type: "asset_shader"},
    {name: "unlit_shader", path: ["assets/shaders/default.vert", "assets/shaders/unlit.frag"], type: "asset_shader"},
    {name: "sphere_mesh", path: "assets/meshes/sphere.mesh", type: "asset_mesh"},
    {name: "grid_shader", path: ["assets/shaders/grid.vert", "assets/shaders/grid.frag"], type: "asset_shader"},
    {name: "plane_mesh", path: "assets/meshes/plane.mesh", type: "asset_mesh"},
];

let scene = [];
let assets = {};

let main_camera = {
    fov: 60, z_near: 0.1, z_far: 1000,
    position: [0, 1, 5], rotation: [0, 0, 0],
    up_vector: [0, 1, 0],
    view_matrix: mat4_identity(),
    orbit: {
        rotation: [0, 0, 0],
        pivot: [0, 1, 0],
        zoom: 5
    }
};

let gl_canvas = document.getElementById("canvas");
let gl = gl_canvas.getContext("webgl2");

load_assets_and_objects(gl, assets_to_load, assets, init);

function resize_canvas(){
    gl_canvas.width = document.documentElement.clientWidth;
    gl_canvas.height = document.documentElement.clientHeight;
    update_camera_projection_matrix(gl, main_camera);
}

function init(){
    scene.push({
        name: "sphere",
        mesh: assets["sphere_mesh"],
        shader: assets["sphere_shader"],
        transform: {
            position: [0, 1, 0],
            scale: [1, 1, 1],
            rotation: quat_id()
        },
        transparent: false
    });

    scene.push({
        name: "light",
        mesh: assets["sphere_mesh"],
        shader: assets["unlit_shader"],
        transform: {
            position: [2, 3, 0],
            scale: [0.2, 0.2, 0.2],
            rotation: quat_id()
        },
        transparent: false
    });

    scene.push({
        name: "grid",
        mesh: assets["plane_mesh"],
        shader: assets["grid_shader"],
        transform: {
            position: [0, 0, 0],
            scale: [1, 1, 1],
            rotation: quat_id()
        },
        transparent: true
    });

    scene.sort(function(a, b){
        return a.transparent ? 1 : -1;
    });

    window.addEventListener("resize", resize_canvas);
    resize_canvas();

    update_camera_view_matrix(gl, main_camera);

    set_shader_uniform(gl, find_object("sphere").shader, "light_pos", find_object("light").transform.position);
    set_shader_uniform(gl, find_object("sphere").shader, "view_pos", main_camera.position);

    update();
}

function update(){
    gl.viewport(0, 0, gl_canvas.width, gl_canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    for(let i = 0; i < scene.length; i++){
        draw(gl, scene[i].mesh, scene[i].shader, scene[i].transform, main_camera);
    }

    window.requestAnimationFrame(update);
}

let last_mouse = [];
let dragging = false;
document.addEventListener("mousedown", function(e){
    if(e.which == 1){
        last_mouse = [e.clientX, e.clientY];
        dragging = true;
    }
});

document.body.addEventListener("contextmenu", function(e){
    e.preventDefault();
});

document.addEventListener("mouseup", function(e){
    dragging = false;
});

document.addEventListener("mousemove", function(e){
    if(dragging){
        let current_mouse = [e.clientX, e.clientY];
        let mouse_delta = vec2_sub(last_mouse, current_mouse);
        let delta_angle = [2*Math.PI/gl_canvas.width, Math.PI/gl_canvas.height];

        main_camera.orbit.rotation = vec3_add(main_camera.orbit.rotation, [mouse_delta[1]*delta_angle[1], mouse_delta[0]*delta_angle[0], 0]);
        main_camera.orbit.rotation[0] = clamp(main_camera.orbit.rotation[0], -Math.PI/2, Math.PI/2);
        last_mouse = [e.clientX, e.clientY];

        update_camera_orbit(main_camera);

        set_shader_uniform(gl, find_object("sphere").shader, "view_pos", main_camera.position);
    }
});

document.addEventListener("wheel", function(e){
    let delta = 0;
    if(Math.abs(e.deltaY) != 0){
        delta = e.deltaY/Math.abs(e.deltaY)/10;
    }
    main_camera.orbit.zoom += delta*main_camera.orbit.zoom/3;
    main_camera.orbit.zoom = Math.max(0.1, main_camera.orbit.zoom);
    update_camera_orbit(main_camera);
    set_shader_uniform(gl, find_object("sphere").shader, "view_pos", main_camera.position);
});

function find_object(name){
    for(let i = 0; i < scene.length; i++){
        if(scene[i].name == name){
            return scene[i];
        }
    }
}

document.addEventListener("keydown", function(e){
    switch(e.key){
        case "a":
            find_object("light").transform.position[0] -= 0.2;
            break;
        case "d":
            find_object("light").transform.position[0] += 0.2;
            break;
        case "w":
            find_object("light").transform.position[2] -= 0.2;
            break;
        case "s":
            find_object("light").transform.position[2] += 0.2;
            break;
        case "q":
            find_object("light").transform.position[1] -= 0.2;
            break;
        case "e":
            find_object("light").transform.position[1] += 0.2;
            break;
    }

    set_shader_uniform(gl, find_object("sphere").shader, "light_pos", find_object("light").transform.position);
})