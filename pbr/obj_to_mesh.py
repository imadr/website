#!/usr/bin/env python3

"""Convert Wavefront OBJ files into the binary .mesh format used by pbr/main.js."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path
from typing import Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert a Wavefront OBJ file into a pbr .mesh file."
    )
    parser.add_argument("input", type=Path, help="Path to the input .obj file")
    parser.add_argument(
        "output",
        type=Path,
        nargs="?",
        help="Path to the output .mesh file (defaults to input path with .mesh suffix)",
    )
    parser.add_argument(
        "--mesh-name",
        default="",
        help="Optional mesh name stored in the file header (defaults to empty string)",
    )
    return parser.parse_args()


def resolve_obj_index(index: str, items: list[tuple[float, ...]], kind: str) -> int:
    raw_index = int(index)
    if raw_index > 0:
        resolved = raw_index - 1
    elif raw_index < 0:
        resolved = len(items) + raw_index
    else:
        raise ValueError(f"OBJ {kind} index 0 is invalid")

    if resolved < 0 or resolved >= len(items):
        raise ValueError(f"OBJ {kind} index {raw_index} is out of range")
    return resolved


def parse_face_vertex(
    token: str,
    positions: list[tuple[float, float, float]],
    texcoords: list[tuple[float, float]],
    normals: list[tuple[float, float, float]],
) -> tuple[int, Optional[int], Optional[int]]:
    parts = token.split("/")
    if not parts or not parts[0]:
        raise ValueError(f"Invalid face vertex token: {token!r}")

    position_index = resolve_obj_index(parts[0], positions, "position")
    texcoord_index: Optional[int] = None
    normal_index: Optional[int] = None

    if len(parts) > 1 and parts[1]:
        texcoord_index = resolve_obj_index(parts[1], texcoords, "texcoord")
    if len(parts) > 2 and parts[2]:
        normal_index = resolve_obj_index(parts[2], normals, "normal")
    if len(parts) > 3:
        raise ValueError(f"Unsupported face vertex token: {token!r}")

    return position_index, texcoord_index, normal_index


def convert_obj_to_mesh(input_path: Path, output_path: Path, mesh_name: str = "") -> dict[str, int]:
    positions: list[tuple[float, float, float]] = []
    texcoords: list[tuple[float, float]] = []
    normals: list[tuple[float, float, float]] = []
    faces: list[list[tuple[int, Optional[int], Optional[int]]]] = []

    with input_path.open("r", encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            tokens = line.split()
            prefix = tokens[0]

            if prefix == "v":
                if len(tokens) < 4:
                    raise ValueError(f"{input_path}:{line_number}: invalid vertex line")
                positions.append(tuple(float(value) for value in tokens[1:4]))
            elif prefix == "vt":
                if len(tokens) < 3:
                    raise ValueError(f"{input_path}:{line_number}: invalid texcoord line")
                texcoords.append((float(tokens[1]), float(tokens[2])))
            elif prefix == "vn":
                if len(tokens) < 4:
                    raise ValueError(f"{input_path}:{line_number}: invalid normal line")
                normals.append(tuple(float(value) for value in tokens[1:4]))
            elif prefix == "f":
                if len(tokens) < 4:
                    raise ValueError(f"{input_path}:{line_number}: face must have at least 3 vertices")
                face = [
                    parse_face_vertex(token, positions, texcoords, normals)
                    for token in tokens[1:]
                ]
                faces.append(face)

    if not positions:
        raise ValueError(f"{input_path} does not contain any vertex positions")
    if not faces:
        raise ValueError(f"{input_path} does not contain any faces")

    has_texcoords = any(texcoord_index is not None for face in faces for _, texcoord_index, _ in face)
    has_normals = any(normal_index is not None for face in faces for _, _, normal_index in face)

    vertex_map: dict[tuple[int, Optional[int], Optional[int]], int] = {}
    vertices: list[float] = []
    indices: list[int] = []

    for face in faces:
        triangle_indices: list[int] = []
        for key in face:
            index = vertex_map.get(key)
            if index is None:
                position_index, texcoord_index, normal_index = key
                px, py, pz = positions[position_index]
                vertex = [px, py, pz]

                if has_normals:
                    if normal_index is None:
                        vertex.extend((0.0, 0.0, 0.0))
                    else:
                        nx, ny, nz = normals[normal_index]
                        vertex.extend((nx, ny, nz))

                if has_texcoords:
                    if texcoord_index is None:
                        vertex.extend((0.0, 0.0))
                    else:
                        tu, tv = texcoords[texcoord_index]
                        vertex.extend((tu, tv))

                index = len(vertex_map)
                vertex_map[key] = index
                vertices.extend(vertex)

            triangle_indices.append(index)

        # Fan triangulation for polygons with more than 3 vertices.
        for i in range(1, len(triangle_indices) - 1):
            indices.extend(
                (
                    triangle_indices[0],
                    triangle_indices[i],
                    triangle_indices[i + 1],
                )
            )

    attributes: list[tuple[str, int]] = [("position", 3)]
    if has_normals:
        attributes.append(("normal", 3))
    if has_texcoords:
        attributes.append(("texcoord", 2))

    mesh_name_bytes = mesh_name.encode("utf-8")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("wb") as handle:
        handle.write(struct.pack("<Q", len(mesh_name_bytes)))
        handle.write(mesh_name_bytes)

        handle.write(struct.pack("<Q", len(attributes)))
        for name, size in attributes:
            name_bytes = name.encode("utf-8")
            handle.write(struct.pack("<Q", len(name_bytes)))
            handle.write(name_bytes)
            handle.write(struct.pack("<I", size))

        handle.write(struct.pack("<Q", len(vertices)))
        handle.write(struct.pack(f"<{len(vertices)}f", *vertices))

        handle.write(struct.pack("<Q", len(indices)))
        handle.write(struct.pack(f"<{len(indices)}I", *indices))

    return {
        "positions": len(positions),
        "texcoords": len(texcoords),
        "normals": len(normals),
        "faces": len(faces),
        "unique_vertices": len(vertex_map),
        "vertex_floats": len(vertices),
        "indices": len(indices),
    }


def main() -> int:
    args = parse_args()
    input_path = args.input.resolve()
    output_path = (args.output or args.input.with_suffix(".mesh")).resolve()

    stats = convert_obj_to_mesh(input_path, output_path, args.mesh_name)
    print(f"Converted {input_path} -> {output_path}")
    print(
        "positions={positions} texcoords={texcoords} normals={normals} "
        "faces={faces} unique_vertices={unique_vertices} indices={indices}".format(**stats)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
