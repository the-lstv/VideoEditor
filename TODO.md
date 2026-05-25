## TODO List
- [ ] Multiple render backends

- [ ] Resize modes/behavior
- [ ] Layout system

- [ ] Video encoding
- [x] Video decoding
- [ ] Proxy file management and proxies in resource system
- [ ] Handle symlinks in the file browser
- [ ] Animated GIF support
- [ ] Asset preview
- [ ] Thumbnail generations

- [ ] Export screen
- [-] Better resource management
- [ ] Backup system

- [ ] Hardware accelerated timeline
- [ ] Timeline previews
- [ ] Multiple switchable timelines, timeline references in composition
- [ ] Timeline to scene & vice versa (well, scene management in general)
- [ ] Drop snapping & preview
- [ ] Playhead snapping
- [ ] Paint mode
- [ ] Fading
- [ ] Objects that aren't limited to primary lifetime (start/length); eg. main camera, main light, etc.
- [ ] Proportional drop for base objects

- [ ] Audio
- [ ] Audio editing
- [ ] Audio mixer
- [ ] Split audio track from video

- [ ] Keyframe animation
- [ ] Data pipelines
- [ ] Scripting API
- [ ] Plugin system

- [ ] Revamp property editor
- [ ] Layout editor

- [ ] 3D objects and compositing
- [ ] 3D tools & viewport
- [ ] 3D roataion & positioning
- [ ] VR editing

- [ ] Color grading, correction, color curves tools
- [ ] Smart color sampling/analysis & matching tools
- [ ] Shaders
- [ ] Groups & scene graphs
- [ ] Effects and transitions
- [ ] Effect pipelies
- [ ] Ready to use effects
- [ ] Physics simulation
- [ ] Motion tracking
- [ ] Cropping
- [ ] Masking
- [ ] Material management

- [ ] Modular controllers
- [ ] External controllers mapping for positioning etc. and hardware (MIDI, etc.)
- [ ] Customizable keyboard shortcuts
- [ ] Enhance Undo/Redo system

- [ ] Remote sources
- [ ] Efficient sync system & remote editing (multiplayer/collaboration mode maybe?)
- [ ] Collaboration features

- [ ] Pixel-perfect previewing tools
- [ ] Shader interface & modules & library
- [ ] General UI improvements
- [ ] Pop asset preview
- [ ] Custom color picker
- [-] Custom file picker
- [ ] Static text objects
- [-] Dynamic text objects
- [ ] Subtitles editing tools
- [ ] Auto-captioning

- [ ] Motion graphics templates
- [ ] Smart editing tools
- [ ] Drop directly on the preview

- [ ] Welcome screen
- [ ] Inform when files/folders are missing & allow to locate them
- [ ] Tutorials & documentation

- [ ] File saving
- [ ] Drop from files

- [ ] Project management

- [ ] Event recording

## Bugs

The resource management is currently one big mess.
Update; I slightly improved it and now have a better idea on how it should be structured, but it is still far from complete. I need more people :(

- Copying with resources/dynamic properties doesn't work.
- Dropping a file resets the file browser
- Images are white for some reason
- Images & videos do not retain proper dimensions or duration