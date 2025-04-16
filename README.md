# Expo IAP (In-App Purchases) Demo for Google Play, Apple App Store (iOS), and Web

<p align="center">
    A reference implementation for in-app purchases using [`expo-iap`](https://github.com/hyochan/expo-iap).
</p>

## Features

- 🤓 Complete backend reference implementation
- 🔗 Webhook subscriptions to get notified about purchases and cancellations
- 🔄 Cross-platform support (iOS, Android, and Web)
- 🤖 Designed for serverless environments like [EAS Hosting](https://docs.expo.dev/eas/hosting/introduction/) or [Cloudflare Workers](https://developers.cloudflare.com/workers/), but should work pretty much anywhere Node.js can run.

## Non-Features

- 🚫 Not designed as a reusable library. Feel free to copy and modify this codebase for your own needs.
- 🚫 Focused around selling a single product (a subscription), but easily extendable to support other types of in-app purchases or multiple products.
- 🚫 There is no database. [Throughout the codebase](https://github.com/lexikon-ai/expo-iap-demo/blob/c314c968365bc1fe847542eba7b3c568bd6bc1c6/app/api/checkout/%5B...everything%5D%2Bapi.ts#L17-L61) you'll see stub functions that you'll need to implement yourself.

## Usage

See [our corresponding blog post]() for more a more in-depth tutorial.

This is a standard [expo default template](https://github.com/expo/expo/tree/main/templates/expo-template-default), feel free to follow the instructions there to get started.

All credit really belongs to [Hyochan](https://github.com/hyochan) + the `expo-iap` [contributors](https://github.com/hyochan/expo-iap/graphs/contributors).
