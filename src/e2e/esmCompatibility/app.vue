<script lang="ts" setup>
const { data } = useFetch('/counter/1');
</script>

<template>
  <div>
    <pre>{{ data }}</pre>
  </div>
</template>
