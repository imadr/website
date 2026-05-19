let grad_basis = [ 1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1 ]

function init_tables(tab, perm_table, grad_table) {
    for(let i = 0; i < 256; ++i){
        perm_table[i] = tab[i];
        perm_table[i+256] = tab[i];
    }
    let grad_idx = 0;
    for(let i = 0; i < perm_table.length; ++i){
        let v = (perm_table[i]%12)*3;
        grad_table[grad_idx++] = grad_basis[v];
        grad_table[grad_idx++] = grad_basis[v+1];
        grad_table[grad_idx++] = grad_basis[v+2];
    }
}

function generate_permutation_table(rand){
    let p = [];
    for(let i = 0; i < 256; i++){
        p.push(i);
    }
    let current_index = p.length, random_index;
    while(0 !== current_index){
        random_index = rand()%current_index;
        current_index--;
        [p[current_index], p[random_index]] = [p[random_index], p[current_index]];
    }
    return p;
}

function get_noise_function(tab){
    let ab = new ArrayBuffer(2048);
    let perm_table = new Uint8Array(ab, 0, 512);
    let grad_table = new Int8Array(ab, 512, 1536);
    init_tables(tab, perm_table, grad_table);

    return function (x, y, z, x_wrap, y_wrap, z_wrap){
        x_wrap = x_wrap | 0;
        y_wrap = y_wrap | 0;
        z_wrap = z_wrap | 0;
        x = +x;
        y = +y;
        z = +z;
        var x_mask = ((x_wrap-1) & 255) >>> 0;
        var y_mask = ((y_wrap-1) & 255) >>> 0;
        var z_mask = ((z_wrap-1) & 255) >>> 0;
        var px = Math.floor(x);
        var py = Math.floor(y);
        var pz = Math.floor(z);
        var x0 = (px+0) & x_mask;
        var x1 = (px+1) & x_mask;
        var y0 = (py+0) & y_mask;
        var y1 = (py+1) & y_mask;
        var z0 = (pz+0) & z_mask;
        var z1 = (pz+1) & z_mask;
        x -= px;
        y -= py;
        z -= pz;
        var u = ((x*6.0-15.0)*x + 10.0) * x * x * x;
        var v = ((y*6.0-15.0)*y + 10.0) * y * y * y;
        var w = ((z*6.0-15.0)*z + 10.0) * z * z * z;
        var r0 = perm_table[x0];
        var r1 = perm_table[x1];
        var r00 = perm_table[r0+y0];
        var r01 = perm_table[r0+y1];
        var r10 = perm_table[r1+y0];
        var r11 = perm_table[r1+y1];
        var h000 = perm_table[r00+z0] * 3;
        var h001 = perm_table[r00+z1] * 3;
        var h010 = perm_table[r01+z0] * 3;
        var h011 = perm_table[r01+z1] * 3;
        var h100 = perm_table[r10+z0] * 3;
        var h101 = perm_table[r10+z1] * 3;
        var h110 = perm_table[r11+z0] * 3;
        var h111 = perm_table[r11+z1] * 3;
        var n000 = grad_table[h000]*(x+0) + grad_table[h000+1]*(y+0) + grad_table[h000+2]*(z+0);
        var n001 = grad_table[h001]*(x+0) + grad_table[h001+1]*(y+0) + grad_table[h001+2]*(z-1);
        var n010 = grad_table[h010]*(x+0) + grad_table[h010+1]*(y-1) + grad_table[h010+2]*(z+0);
        var n011 = grad_table[h011]*(x+0) + grad_table[h011+1]*(y-1) + grad_table[h011+2]*(z-1);
        var n100 = grad_table[h100]*(x-1) + grad_table[h100+1]*(y+0) + grad_table[h100+2]*(z+0);
        var n101 = grad_table[h101]*(x-1) + grad_table[h101+1]*(y+0) + grad_table[h101+2]*(z-1);
        var n110 = grad_table[h110]*(x-1) + grad_table[h110+1]*(y-1) + grad_table[h110+2]*(z+0);
        var n111 = grad_table[h111]*(x-1) + grad_table[h111+1]*(y-1) + grad_table[h111+2]*(z-1);
        var n00 = n000 + (n001-n000) * w;
        var n01 = n010 + (n011-n010) * w;
        var n10 = n100 + (n101-n100) * w;
        var n11 = n110 + (n111-n110) * w;
        var n0 = n00 + (n01-n00) * v;
        var n1 = n10 + (n11-n10) * v;
        return n0 + (n1-n0) * u;
    };
}