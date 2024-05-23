# Multistate

**Save** and **restore** the entire state of WebGL easily like in a 2D canvas. Multistate manages the global state only and is not concerned with any properties or content of any textures, buffers, VAOs etc. It also adds cache checks for all the global-state-setting functions to prevent redundant WebGL API calls.

## Handles
1. Global settings including viewport, culling, blending, stencil etc.
2. State toggles managed by gl.enable and gl.disable
3. Options configured with pixelStorei
4. Currently bound textures
5. Currently bound framebuffers with their read/draw buffers settings
6. Current VAO and UBO
7. Current program

## Is not concerned with
1. Uniforms and attributes
2. Any individual buffer settings or content
3. Any individual texture settings or content

## Quick start

### Installation

```sh
npm install multistate
```


### Basic usage

```javascript
import { enhanceWebGLContext } from 'multistate'

gl = canvas.getContext('webgl2')
enhanceWebGLContext(gl)

// .. run your setup here

// set any global params
gl.viewport(0, 0, 500, 500)

gl.saveState()

// make some changes
gl.viewport(0, 0, 200, 200)
gl.enable(gl.CULL_FACE)

gl.restoreState()

// the viewport is now [0, 0, 500, 500]
console.log(gl.getParameter(gl.VIEWPORT))
// the face culling is now disabled
console.log(gl.isEnabled(gl.CULL_FACE))


```

### Multiple state containers

```javascript
// save the container once
const stateContainerA = gl.createState()
const stateContainerB = gl.createState()

// pass the container as a paramter to write to it
gl.saveState(stateContainerA)
gl.restoreState(stateContainerB)
gl.restoreState(stateContainerA)

```

### Keeping WebGL state predictable

Forgetting to change some WebGL parameter back after setting it up for a particular draw call means that it will now affect all other draw calls. 
Instead of meticulously keeping track of every change of WebGL state between drawing elements and unsetting previously set parameters you can just make a mess and clean up the state after each item is drawn. When running `restoreState` all the properties in `baseSetup` are checked against the current state and no WebGL commands will be sent unnecessarily.

```javascript
const baseSetup = gl.createState()

// Here set up the common settings like the viewport etc ...

gl.saveState(baseSetup)


// Item 1 WebGl setup and draw call here ...

gl.restoreState(baseSetup)

// Item 2 WebGl setup and draw call here ...

gl.restoreState(baseSetup)

// Item 3 WebGl setup and draw call here ...

gl.restoreState(baseSetup)


```