const data = {
    foo: 1
}
let activeEffect,// 当前被激活的副作用函数
    effectStack = [], // 副作用函数栈
    jobQueue = new Set() // 任务队列,通过Set自动去重相同的副作用函数

const bucket = new WeakMap() // 副作用函数的桶 使用WeakMap
const p = Promise.resolve() // 使用promise实例将任务添加到微任务队列

let isFlushing = false // 是否正在刷新队列
function flushJob() {
    if (isFlushing) return // 如果正在刷新，则什么也不做
    isFlushing = true // 正在刷新
    p.then(() => { // 将副作用函数的执行放到微任务队列中
        jobQueue.forEach(effectFn => effectFn()) // 取出任务队列中的所有副作用函数执行
    }).finally(() => {
        isFlushing = false // 重置刷新标志
    })
}

function effect(fn, options = {}) {
    const effectFn = () => {
        // 副作用函数执行之前，将该函数从其所在的依赖集合中删除
        cleanup(effectFn)
        // 当effectFn执行时，将其设置为当前激活的副作用函数
        activeEffect = effectFn
        effectStack.push(activeEffect) // 将当前副作用函数推进栈
        fn()
        // 当前副作用函数结束后，将此函数推出栈顶，并将activeEffect指向栈顶的副作用函数
        // 这样：响应式数据就只会收集直接读取其值的副作用函数作为依赖
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
    }
    effectFn.deps = [] // activeEffect.deps用来存储所有与该副作用函数相关联的依赖集合
    effectFn.options = options // 将用户传进来的options挂载到副作用函数effectFn上
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
    set(target, p, value, receiver) {
        target[p] = value
        trigger(target, p) // 把副作用函数取出并执行
        return true
    }
})

// track函数
function track(target, key) {
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
function trigger(target, key) {
    const depsMap = bucket.get(target) // target Map
    if (!depsMap) return;
    const effects = depsMap.get(key) // effectFn Set
    const effectToRun = new Set()
    effects && effects.forEach(effectFn => { // 增加守卫条件
        if (effectFn !== activeEffect) { // trigger触发执行的副作用函数如果和当前正在执行的副作用函数一样，就不触发执行
            effectToRun.add(effectFn)
        }
    })
    effectToRun && effectToRun.forEach(fn => {
        if (fn.options.scheduler) { // 该副作用函数选项options中的调度器函数存在
            fn.options.scheduler(fn)
        } else { // 如果不存在scheduler调度函数，则直接调用副作用函数
            fn()
        }
    })
}


effect(
    () => {
        console.log(obj.foo)
    },
    {
        scheduler(fn) {
            // 每次调度时, 将副作用函数添加到任务队列中。注意：同一个副作用函数加进去会由于jobQueue是Set而去重
            // 当宏任务完成后，值已经是最终状态，中间状态的值不会通过副作用函数体现出来
            jobQueue.add(fn)
            // 调用flushJob刷新队列
            flushJob()
        },
    })

obj.foo++
obj.foo++

console.log(`over`)
