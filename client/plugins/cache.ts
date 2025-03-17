import { ref, Ref } from "vue";
import type { CacheOptions } from "axios-cache-interceptor";
import { buildStorage, buildWebStorage } from "axios-cache-interceptor";
import { SocketClient, SocketClientPlugin, StringKeyOf } from "../index";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventsMap = Record<string, any>;

type SocketCacheOptions<Events extends EventsMap> = Required<Pick<
    CacheOptions,
    "storage"
>> & {
    ttl: number | ((event: StringKeyOf<Events>, args: unknown[]) => number);
    disableCache?: (eventName: string) => boolean;
};

export class CachePlugin implements SocketClientPlugin {
    name = 'cache';
    private hydratorState: Ref<{
        mode: "LOAD_CACHE" | "HYDRATE";
        cachedCallsDone: string[];
        hydratedCallsDoneAmount: number;
    } | undefined> = ref(undefined);

    constructor(public cacheOptions?: SocketCacheOptions<any>) { }

    install(client: SocketClient): void {
        // Add hydrator to the client
        Object.defineProperty(client, 'hydrator', {
            get: () => ({
                state: this.hydratorState,
                run: this.runHydration.bind(this),
            })
        });
    }

    async beforeEmit<Events extends EventsMap>(
        namespaceName: string,
        eventName: StringKeyOf<Events>,
        args: any[],
        context: { isOffline?: boolean; cacheKey?: string }
    ): Promise<{ shouldContinue: boolean; result?: any }> {
        const cache = this.cacheOptions
        if (!cache) {
            return { shouldContinue: true };
        }

        const cacheKey = `${namespaceName}/${eventName} ${JSON.stringify(args)}`;
        context.cacheKey = cacheKey;

        const cacheData = await cache.storage.get(cacheKey, {
            cache: {
                ttl:
                    context.isOffline ||
                        this.hydratorState.value?.mode === "LOAD_CACHE"
                        ? undefined
                        : typeof cache.ttl === "function"
                            ? cache.ttl(eventName, args)
                            : cache.ttl,
            },
        });

        const isCacheUsed =
            cacheData !== undefined &&
            !(typeof cacheData === "object" && cacheData.state === "empty");

        if (isCacheUsed) {
            console.debug(`${namespaceName}/${eventName}(${JSON.stringify(args).replace(/[\[\]]/g, "")}) served from cache`);

            if (this.hydratorState.value) {
                const eventConsoleString = `${namespaceName}/${eventName}(${JSON.stringify(args).replace(/[\[\]]/g, "")})`;
                switch (this.hydratorState.value.mode) {
                    case "LOAD_CACHE":
                        this.hydratorState.value.cachedCallsDone.push(eventConsoleString);
                        break;
                    case "HYDRATE":
                        if (this.hydratorState.value.cachedCallsDone.includes(eventConsoleString)) {
                            this.hydratorState.value.hydratedCallsDoneAmount++;
                        }
                        break;
                }
            }

            return { shouldContinue: false, result: cacheData };
        }

        return { shouldContinue: true };
    }

    async afterEmit<Events extends EventsMap>(
        namespaceName: string,
        eventName: StringKeyOf<Events>,
        args: any[],
        result: any,
        context: { isOffline?: boolean; cacheKey?: string }
    ): Promise<any> {
        const cache = this.cacheOptions
        if (!cache || !context.cacheKey) {
            return result;
        }

        cache.storage.set(context.cacheKey, result, {
            timeout:
                typeof cache.ttl === "function"
                    ? cache.ttl(eventName, args)
                    : cache.ttl,
        });

        if (
            this.hydratorState.value?.mode === "HYDRATE" &&
            this.hydratorState.value.cachedCallsDone.includes(
                `${namespaceName}/${eventName}(${JSON.stringify(args).replace(/[\[\]]/g, "")})`
            )
        ) {
            this.hydratorState.value.hydratedCallsDoneAmount++;
        }

        return result;
    }

    onConnectError(error: Error, namespaceName: string): void {
        // Handle connect error for cache-specific logic
    }

    async runHydration(
        loadCachedDataFn: () => Promise<void>,
        loadRealDataFn: () => void,
    ): Promise<void> {
        this.hydratorState.value = {
            mode: "LOAD_CACHE",
            cachedCallsDone: [],
            hydratedCallsDoneAmount: 0,
        };

        console.debug("loading cache...");
        await loadCachedDataFn();

        this.hydratorState.value.mode = "HYDRATE";
        this.hydratorState.value.hydratedCallsDoneAmount = 0;

        console.debug("Hydrating...");
        loadRealDataFn();
    }
}

// Re-export axios-cache-interceptor utilities from the plugin file
export type { AxiosStorage, NotEmptyStorageValue } from "axios-cache-interceptor";
export { buildStorage, buildWebStorage };
