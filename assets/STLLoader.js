const THREE = require('three');

class STLLoader {
  constructor(manager) {
    this.manager = (manager !== undefined) ? manager : THREE.DefaultLoadingManager;
  }

  load(url, onLoad, onProgress, onError) {
    const scope = this;
    const loader = new THREE.FileLoader(scope.manager);
    loader.setPath(scope.path);
    loader.setResponseType('arraybuffer');
    loader.setWithCredentials(scope.withCredentials);
    loader.load(url, function (text) {
      try {
        onLoad(scope.parse(text));
      } catch (e) {
        if (onError) {
          onError(e);
        } else {
          console.error(e);
        }
        scope.manager.itemError(url);
      }
    }, onProgress, onError);
  }

  parse(data) {
    function isBinary(data) {
      const reader = new DataView(data);
      const face_bytes = reader.getUint32(80, true);
      const n_faces = reader.getUint32(0, true);
      return face_bytes === n_faces * 50 && n_faces !== 0 && data.byteLength !== 0;
    }

    let geometry;
    if (isBinary(data)) {
      geometry = this.parseBinary(data);
    } else {
      geometry = this.parseASCII(new TextDecoder().decode(data));
    }
    return geometry;
  }

  parseBinary(data) {
    const reader = new DataView(data);
    const faces = reader.getUint32(0, true);
    const dataOffset = 84;
    const faceLength = 12 * 4 + 2;
    const geometry = new THREE.BufferGeometry();

    const vertices = new Float32Array(faces * 3 * 3);
    const normals = new Float32Array(faces * 3 * 3);

    for (let face = 0; face < faces; face++) {
      const start = dataOffset + face * faceLength;
      const normalX = reader.getFloat32(start, true);
      const normalY = reader.getFloat32(start + 4, true);
      const normalZ = reader.getFloat32(start + 8, true);

      for (let i = 1; i <= 3; i++) {
        const vertexstart = start + 12 + (i - 1) * 12;
        vertices[face * 9 + (i - 1) * 3] = reader.getFloat32(vertexstart, true);
        vertices[face * 9 + (i - 1) * 3 + 1] = reader.getFloat32(vertexstart + 4, true);
        vertices[face * 9 + (i - 1) * 3 + 2] = reader.getFloat32(vertexstart + 8, true);

        normals[face * 9 + (i - 1) * 3] = normalX;
        normals[face * 9 + (i - 1) * 3 + 1] = normalY;
        normals[face * 9 + (i - 1) * 3 + 2] = normalZ;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    return geometry;
  }

  parseASCII(data) {
    const geometry = new THREE.BufferGeometry();
    const patternFace = /facet\s+normal\s+([\d\.\-\eE]+)\s+([\d\.\-\eE]+)\s+([\d\.\-\eE]+)/;
    const patternVertex = /vertex\s+([\d\.\-\eE]+)\s+([\d\.\-\eE]+)\s+([\d\.\-\eE]+)/;
    const vertices = [];
    const normals = [];

    const lines = data.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const faceMatch = line.match(patternFace);
      if (faceMatch) {
        const normal = [parseFloat(faceMatch[1]), parseFloat(faceMatch[2]), parseFloat(faceMatch[3])];
        normals.push(...normal, ...normal, ...normal);
      }
      const vertexMatch = line.match(patternVertex);
      if (vertexMatch) {
        vertices.push(parseFloat(vertexMatch[1]), parseFloat(vertexMatch[2]), parseFloat(vertexMatch[3]));
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    geometry.computeBoundingBox();
    return geometry;
  }
}

module.exports = STLLoader;