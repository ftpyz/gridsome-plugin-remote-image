const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const imageType = require('image-type')
const imageDownload = require('image-download')
const validate = require('validate.js')
const chalk = require('chalk')
const _ = require('lodash')
const normalizeUrl = require('normalize-url')


class ImageDownloader {
    constructor(api, options) {

        //no one is perfect, so we check that all required
        //config values are defined in `gridsome.config.js`
        const validationResult = this.validateOptions(options);
        if( validationResult ) {
            console.log();
            console.log(`${chalk.yellowBright('Remote images are not downloaded. Please check your configuration.')}`)
            console.log(`${chalk.yellowBright('* '+validationResult.join('\n* '))}`)
            console.log();

            return null;
        }

        this.options = options;
        this.api = api;

        //initialize the `loadImage` event and make 
        //it available before we run the `onBootstrap` command
        this.initializeEvent(api);

        //create a new type `Images` which is required
        //for array support
        //also add a new field to the defined collection
        //to store the downloaded images
        api.createSchema(({ addSchemaTypes }) => {
            const fieldType = this.getFieldType(api, options);
            this.generateSchemaType(addSchemaTypes, fieldType);
        });

        //run the plugin code, after gridsome finished all their work ( right? )
        api.onBootstrap(() => this.loadImages())
    }

    /**
     * Create a new event via the gridsome plugin api
     * reference: node_modules/gridsome/lib/app/PluginAPI.js
     */
    initializeEvent(api) {
        api._on('loadImage', this.runDownloader)
    }

    /**
     * Run the defined event with the required
     * arguments - i have no clue why `this` is not available
     * but I'm too tired to check this in detail...
     * Defining the needed methods is fine for me :) 
     */
    async loadImages() {
        await this.run('loadImage', null, {
            getFieldType: this.getFieldType,
            getRemoteImage: this.getRemoteImage,
            updateNodes: this.updateNodes,
            options: this.options
        })
    }

    /**
     * Defined in `initializeEvent`
     * Called via `loadImages`
     */
    async runDownloader(plugin, api) {
        const fieldType = plugin.getFieldType(api, plugin.options);
        await plugin.updateNodes(api, fieldType, plugin)
    }

    getFieldType(api, options) {
        
        const nodeCollection = api._app.store.getCollection(options.typeName);

        let findQuery = {};

        //details about this definition can be found here
        //https://github.com/techfort/LokiJS/wiki/Query-Examples#find-operator-examples-
        findQuery[options.sourceField] = {
            '$exists': true
        };

        const node = nodeCollection.findNode(findQuery);

        //we're using the lodash get functionality
        //to allow a dot notation in the source field name
        return (node) ? typeof _.get(node, options.sourceField) : false;
    }

    generateSchemaType(addSchemaTypes, fieldType) {
        
        const schemaType = (fieldType == 'string') ? 'Image' : '[Images]';
        
        addSchemaTypes(
            `
                type Images  {
                    image: Image
                }
            `
        );

        //extend the existing schema
        addSchemaTypes(
            `
                type ${this.options.typeName} implements Node @infer {
                    ${this.options.targetField}: ${schemaType}
                }
            `
        );  
    }

    async updateNodes(api, fieldType, plugin) {
        
        var collection = api._app.store.getCollection(plugin.options.typeName);

        collection.data().forEach(async function (node) {
            
            if (_.get(node,plugin.options.sourceField)) {
                const imagePaths = await plugin.getRemoteImage(node, fieldType, plugin.options);

                if( fieldType == 'string' ) {
                    node[plugin.options.targetField] = imagePaths[0];
                } else {
                   
                    node[plugin.options.targetField] = _.map(imagePaths, function(imagePath) {
                        return {
                            image: imagePath
                        };
                    });   
                }

                var res = collection.updateNode(node);
            }
        })
    }

    async getRemoteImage(node, fieldType, options) {

        const sourceField = options.sourceField;
        const imageSources = (fieldType == 'string') ? [_.get(node,sourceField)] : _.get(node,sourceField);
        
        let imagePaths = await Promise.all(
            _.map(imageSources, async (imageSource) => {

                imageSource = normalizeUrl(imageSource,{'forceHttps' : true})
                                
                return await imageDownload(imageSource).then(buffer => {

                    const hash = crypto.createHash('sha256');
                    hash.update(imageSource);
                    var targetFileName = hash.digest('hex');
                    
                    const type = imageType(buffer);

                    const filePath = path.resolve(
                        options.targetPath, 
                        `${targetFileName}.${type.ext}`
                    )

                    if( fs.existsSync(filePath) ) {
                        return filePath;
                    }
                    
                    if (!fs.existsSync(options.targetPath)) {
                        fs.mkdirSync(options.targetPath)
                    }

                    fs.writeFile(filePath, buffer, (err) => console.log(err ? err : ''));
                    return filePath;
                });
            })
        );
        
        return imagePaths;
    }

    /**********************
     * Helpers
     **********************/

    /**
     * Copied from node_modules/gridsome/lib/app/Plugins.js
     */
    async run(eventName, cb, ...args) {

        if (!this.api._app.plugins._listeners[eventName]) return []

        const results = []

        for (const entry of this.api._app.plugins._listeners[eventName]) {
            if (entry.options.once && entry.done) continue

            const { api, handler } = entry
            const result = typeof cb === 'function'
                ? await handler(cb(api))
                : await handler(...args, api)

            results.push(result)
            entry.done = true
        }

        return results
    }

    validateOptions(options = {}) {
        const contraintOption = {
            presence: {
                allowEmpty: false
            }
        };

        const constraints = {
            typeName: contraintOption,
            sourceField: contraintOption,
            targetField: contraintOption,
            targetPath: contraintOption
        };

        const validationResult = validate(options, constraints, {
            format: "flat"
        });

        return validationResult;
    }
}

module.exports = ImageDownloader
