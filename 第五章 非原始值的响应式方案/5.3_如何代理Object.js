
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
        const res = fn() // lazy选项，getter函数，执行的结果res
        // 当前副作用函数结束后，将此函数推出栈顶，并将activeEffect指向栈顶的副作用函数
        // 这样：响应式数据就只会收集直接读取其值的副作用函数作为依赖
        effectStack.pop()
        activeEffect = effectStack[effectStack.length - 1]
        return res;// 将函数的结果传递出去，配合lazy选项
    }
    effectFn.deps = [] // activeEffect.deps用来存储所有与该副作用函数相关联的依赖集合
    effectFn.options = options // 将用户传进来的options挂载到副作用函数effectFn上
    if (options.lazy) { // lazy的话就把副作用函数返回出去
        return effectFn
    } else { // 否则就立即执行该副作用函数
        effectFn()
    }
}

function cleanup(effectFn) {
    for (let i = 0, len = effectFn.deps.length; i < len; i++) {
        let deps = effectFn.deps[i] // 依赖集合
        deps.delete(effectFn)
    }
    effectFn.deps.length = 0 // 重置effectFn的deps数组
}



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
function trigger(target, key, type) {
    const depsMap = bucket.get(target) // target Map
    if (!depsMap) return;
    const effects = depsMap.get(key) // effectFn Set
    const iterateEffects = depsMap.get(ITERATE_KEY) // iterateEffects Set

    const effectToRun = new Set()
    effects && effects.forEach(effectFn => { // 增加守卫条件
        if (effectFn !== activeEffect) { // trigger触发执行的副作用函数如果和当前正在执行的副作用函数一样，就不触发执行
            effectToRun.add(effectFn)
        }
    })
    // 如果操作是添加操作，才将iterate_key相关联的副作用函数取出执行
    if (type === 'ADD' || type === 'DELETE') {
        iterateEffects && iterateEffects.forEach(fn => { // 将iterate相关的副作用函数也添加到effectToRun
            if (fn !== activeEffect) {
                effectToRun.add(fn)
            }
        })
    }

    effectToRun && effectToRun.forEach(fn => {
        if (fn.options.scheduler) { // 该副作用函数选项options中的调度器函数存在
            fn.options.scheduler(fn)
        } else { // 如果不存在scheduler调度函数，则直接调用副作用函数
            fn()
        }
    })
}

const data = {
    foo: 1,
    bar: 2
}

const ITERATE_KEY = Symbol('iterate key')
const obj = new Proxy(data, {
    get(target, p, receiver) {
        track(target, p)
        return Reflect.get(...arguments)
    },
    set(target, p, value, receiver) {
        const type = Object.prototype.hasOwnProperty.call(target, p) ? 'SET' : 'ADD' // 如果target没这个属性，track中为SET操作，否则为ADD操作
        const res = Reflect.set(...arguments)
        trigger(target, p, type) // 把副作用函数取出并执行
        return res
    },
    has(target, p) { // 拦截 in 操作符, in操作符内部最终调用了对象的[[HasProperty]]内部方法，该内部方法可以被Proxy的has拦截函数拦截
        track(target, p)
        return Reflect.has(target, p)
    },
    ownKeys(target) { // 拦截 for in 循环，只有target参数
        track(target, ITERATE_KEY)
        return Reflect.ownKeys(target)
    },
    deleteProperty(target, p) { // 拦截delete操作, delete操作也会影响for in 循环，所以传递DELETE参数到trigger函数
        const hasKey = Object.prototype.hasOwnProperty.call(target, p) // 测试target是否有这个property
        const res = Reflect.deleteProperty(target, p)
        if (hasKey && res) { // 删除成功且target有这个key
            trigger(target, p, 'DELETE')
        }
        return res
    }
})

effect(() => {
    for (const key in obj) {
        console.log(key)
    }
})

delete obj.foo
