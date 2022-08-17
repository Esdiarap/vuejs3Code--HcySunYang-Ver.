const data = {
    text: 'helloWorld',
    ok: true
}
let activeEffect
const bucket = new WeakMap() // 副作用函数的桶 使用WeakMap

function effect(fn) {
    const effectFn = () => {
        // 副作用函数执行之前，将该函数从其所在的依赖集合中删除
        cleanup(effectFn)
        // 当effectFn执行时，将其设置为当前激活的副作用函数
        activeEffect = effectFn
        fn()
    }
    effectFn.deps = [] // activeEffect.deps用来存储所有与该副作用函数相关联的依赖集合
    effectFn()
}

function cleanup(effectFn) {
    for (let i = 0, len = effectFn.deps.length; i < len; i++) {
        let deps = effectFn.deps[i] // 依赖集合
        deps.delete(effectFn)
    }
    effectFn.deps.length = 0 // 重置effectFn的deps数组
}

const obj = new Proxy(data, {
    get(target, p, receiver) {
        track(target, p)
        return target[p]
    },
    set(target, p, value, receiver): boolean {
        target[p] = value
        trigger(target, p) // 把副作用函数取出并执行
        return true
    }
})

// track函数
function track(target, key: string | symbol) {
    if (!activeEffect) return // 没有正在执行的副作用函数 直接返回
    let depsMap = bucket.get(target)
    if (!depsMap) { // 不存在，则创建一个Map
        bucket.set(target, depsMap = new Map())
    }
    let deps = depsMap.get(key) // 根据key得到 depsSet(set类型), 里面存放了该 target-->key 对应的副作用函数
    if (!deps) { // 不存在，则创建一个Set
        depsMap.set(key, (deps = new Set()))
    }
    deps.add(activeEffect) // 将副作用函数加进去
    // deps就是当前副作用函数存在联系的依赖集合
    // 将其添加到activeEffect.deps数组中
    activeEffect.deps.push(deps)
}

// trigger函数
function trigger(target, key: string | symbol) {
    const depsMap = bucket.get(target) // target Map
    if (!depsMap) return;
    const effects = depsMap.get(key) // effectFn Set
    const effectToRun = new Set(effects)
    effectToRun && effectToRun.forEach(fn => {
        if (typeof fn === 'function') fn()
    })
}

effect(() => {
    console.log('effect run')
    document.body.innerHTML = obj.ok ? obj.text : 'no'
})

setTimeout(() => {
    obj.ok = false
}, 1000)

setTimeout(() => {
    obj.text = 'ds'
}, 2000)
