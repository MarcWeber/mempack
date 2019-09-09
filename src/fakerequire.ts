// require for systemjs modules

// for running and requiring the JS module in plv8 postgresql
// the code of this file
// the outFile contents with module = system
// Example: console.log(System.require('shared/import/CSV').phone_clean('0 1'));
export const fakerequire = `
System = {}
System.registered_modules = {}
System.loaded_modules     = {}
System.register = function(path, deps, module_function) {
  System.registered_modules[path] = {"dependencies": deps, "module_function": module_function}
}
System.require = function(path) {
  if (!System.loaded_modules[path]) {
    System.load(path)
  }
  return System.loaded_modules[path];
}
System.load = (path) => { throw "implement this"; }
`
