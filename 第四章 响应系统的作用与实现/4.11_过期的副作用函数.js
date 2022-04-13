const data = {
    foo: 1,
    bar: 2
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

const obj = new Proxy(data, {
    get(target, p, receiver) {
        track(target, p)
        return Reflect.get(...arguments)
    },
    set(target, p, value, receiver) {
        Reflect.set(...arguments)
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

// watch函数，source是响应式数据，cb回调函数
function watch(source, cb, options = {}) {
    let getter
    if (typeof source === 'function') {// 说明传递进来的是一个getter函数,只需要watch这个getter函数的返回值
        getter = source
    } else {
        getter = () => traverse(source)
    }
    let oldValue, newValue
    let cleanup // cleanup用来保存上一次回调的过期处理函数
    function onInvalidate(fn) {
        cleanup = fn
    }

    function job() {
        newValue = effectFn() // 数据更新时调用副作用函数，并将更新的值放到newValue上
        if (cleanup) cleanup() // 如果上一次回调注册了过期处理函数，则先执行过期处理函数
        cb(oldValue, newValue, onInvalidate)
        oldValue = newValue // 更新旧值
    }

    const effectFn = effect(
        () => {
            return getter() // 调用getter函数，要么是读取所有属性，要么是读取特定属性
        },
        {
            lazy: true,
            scheduler(fn) {
                // flush如果是post,放到微任务队列中执行
                if (options.flush === 'post') {
                    // 会执行n次
                    // const p = Promise.resolve()
                    // p.then(() => job())
                    // 只执行一次，不关心中间状态
                    jobQueue.add(job)
                    flushJob() // flushJob函数加了第一个参数，用于此处.
                }else job()
            }
        }
    )
    if (options.immediate) {
        job() // 直接触发scheduler函数，里面会触发cb
    } else {
        oldValue = effectFn() // 执行一次副作用函数, 但不执行cb，因为cb是在数据更新的时候通过scheduler进行调用的
    }
}

// 遍历source读取
function traverse(value, seen = new Set()) {
    // source是原始值, null, 或者已经读取过，就直接返回
    if (typeof value !== 'object' || value === null || seen.has(value)) return
    seen.add(value)
    // 不考虑数组等结构，只考虑source是一个对象
    // for in 读取对象的每一个值
    for (const k in value) {
        traverse(value[k], seen)
    }
    return value
}

// 此处如果watch的是整个响应式数据，则无法取得oldValue和newValue
watch(() => obj.foo, async (oldValue, newValue, onInvalidate) => {
    // let expired = false
    // onInvalidate(() => expired = true)
    console.log('oldValue: ', oldValue, 'newValue: ', newValue)

}, {
    // immediate: true, // 立即执行一次cb
    flush: 'post' // cb执行时机,在更新后。取值: post, sync, pre
})

obj.foo++
obj.foo++
obj.foo++
obj.foo++
obj.foo++
