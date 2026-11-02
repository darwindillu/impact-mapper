<template><div><h2>Article comments</h2><button>Save the comment</button></div></template>
<script setup lang="ts">
import axios from "axios";
const load = (slug: string) => axios.get(`/api/articles/${slug}/comments`);
</script>
