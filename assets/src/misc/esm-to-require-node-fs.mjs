// TODO: Handle this properly
// I guess let's hope modules don't freak out
export default typeof require === 'undefined' ? null : require('fs').promises;