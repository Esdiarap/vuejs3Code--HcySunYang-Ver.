var data = {
    text: 'helloWorld',
    ok: true
};
var activeEffect;
var bucket = new WeakMap(); // 副作用函数的桶 使用WeakMap
function effect(fn) {
    var effectFn = function () {
        // 副作用函数执行之前，将该函数从其所在的依赖集合中删除
        cleanup(effectFn);
        // 当effectFn执行时，将其设置为当前激活的副作用函数
        activeEffect = effectFn;
        fn();
    };
    effectFn.deps = []; // activeEffect.deps用来存储所有与该副作用函数相关联的依赖集合
    effectFn();
}
function cleanup(effectFn) {
    for (var i = 0, len = effectFn.deps.length; i < len; i++) {
        var deps = effectFn.deps[i]; // 依赖集合
        deps.delete(effectFn);
    }
    effectFn.deps.length = 0; // 重置effectFn的deps数组
}
var obj = new Proxy(data, {
    get: function (target, p, receiver) {
        track(target, p);
        return target[p];
    },
    set: function (target, p, value, receiver) {
        target[p] = value;
        trigger(target, p); // 把副作用函数取出并执行
        return true;
    }
});
// track函数
function track(target, key) {
    if (!activeEffect)
        return; // 没有正在执行的副作用函数 直接返回
    var depsMap = bucket.get(target);
    if (!depsMap) { // 不存在，则创建一个Map
        bucket.set(target, depsMap = new Map());
    }
    var deps = depsMap.get(key); // 根据key得到 depsSet(set类型), 里面存放了该 target-->key 对应的副作用函数
    if (!deps) { // 不存在，则创建一个Set
        depsMap.set(key, (deps = new Set()));
    }
    deps.add(activeEffect); // 将副作用函数加进去
    // deps就是当前副作用函数存在联系的依赖集合
    // 将其添加到activeEffect.deps数组中
    activeEffect.deps.push(deps);
}
// trigger函数
function trigger(target, key) {
    var depsMap = bucket.get(target); // target Map
    if (!depsMap)
        return;
    var effects = depsMap.get(key); // effectFn Set
    var effectToRun = new Set(effects);
    effectToRun && effectToRun.forEach(function (fn) {
        if (typeof fn === 'function')
            fn();
    });
}
effect(function () {
    console.log('effect run');
    document.body.innerHTML = obj.ok ? obj.text : 'no';
});
setTimeout(function () {
    obj.ok = false;
}, 1000);
setTimeout(function () {
    obj.text = 'ds';
}, 2000);
//# sourceMappingURL=4.4_%E5%88%86%E6%94%AF%E5%88%87%E6%8D%A2%E4%B8%8Ecleanup.js.map